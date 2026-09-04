// search command — run a zhaopin job search through a real browser and parse
// the server-rendered result cards.

import type { Page } from "playwright"
import {
  buildSearchUrl,
  EMPTY_MARKER,
  ensureAuthDir,
  extractCards,
  launchBrowser,
  parseCard,
  renderPlain,
  renderTable,
  resolveTokenUrl,
  writeError,
  type JobResult,
} from "../helpers.js"

export interface SearchOpts {
  query: string
  city: string
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

async function collect(page: Page, url: string): Promise<JobResult[] | null> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 })
  // Wait for either result cards or the empty marker; zhaopin serves the full
  // SSR document, so both appear quickly once navigation commits.
  try {
    await page.waitForSelector("a[href*='/jobdetail/']", { timeout: 20000 })
  } catch {
    const body = (await page.content()) || ""
    if (body.includes("Security Verification")) return null // bot wall — caller retries
    if (body.includes(EMPTY_MARKER)) return []
    return null
  }
  const raw = await extractCards(page)
  return raw.map(parseCard)
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  ensureAuthDir()
  const { browser, context } = await launchBrowser(true)
  try {
    const page = await context.newPage()
    let rows = await collect(page, buildSearchUrl(opts.city, opts.query, opts.page))

    // Bot wall or dead page: one retry after a pause (never more — a wall that
    // survives a backoff is an answer, not a transport error).
    if (rows === null) {
      await page.waitForTimeout(3000)
      rows = await collect(page, buildSearchUrl(opts.city, opts.query, opts.page))
    }

    // Direct path URL can 404 into the empty marker for ASCII / mixed
    // keywords (verified live 2026-08-31: "Java" fails, "架构师" works).
    // Resolve the encoded-kw token via the entry-point redirect and retry once.
    if (rows !== null && rows.length === 0) {
      const tokenUrl = await resolveTokenUrl(page, opts.city, opts.query)
      if (tokenUrl) {
        const withPage = opts.page > 1 ? `${tokenUrl}/p${opts.page}` : tokenUrl
        const retry = await collect(page, withPage)
        if (retry !== null) rows = retry
      }
    }

    if (rows === null) {
      writeError(
        "zhaopin returned a bot-detection wall (Security Verification) for both attempts; try again later or lower the request rate",
        "BOT_WALL",
      )
      return 1
    }

    if (opts.limit !== undefined && rows.length > opts.limit) rows = rows.slice(0, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(rows) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(renderPlain(rows) + "\n")
    } else {
      process.stdout.write(JSON.stringify({ meta: { count: rows.length, page: opts.page }, results: rows }, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  } finally {
    await browser.close()
  }
}
