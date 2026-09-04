// search command — attach to the real Chrome over CDP, navigate a REAL Boss
// search page, and passively capture the joblist.json responses the page
// itself issues. Zero injected requests (the community-documented code-37
// trap), human-paced scrolling while waiting for results.

import {
  attachChrome,
  buildSearchUrl,
  classifyJoblist,
  humanPause,
  humanScroll,
  JOB_LIST_PATH,
  renderPlain,
  renderTable,
  toJobResult,
  writeError,
  type JobListPayload,
} from "../helpers.js"

export interface SearchOpts {
  query: string
  city: string
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  const session = await attachChrome()
  if (!session) {
    writeError(
      "no running Chrome with CDP on port 9222 - run `boss-search setup` first (launches the isolated real Chrome and logs in once)",
      "NO_CDP",
    )
    return 1
  }
  const { browser, context } = session
  try {
    const page = await context.newPage()
    const jobs: import("../helpers.js").BossJob[] = []
    const seenIds = new Set<string>()
    let verdict: "ok" | "risk" | "login" | "empty" | null = null

    page.on("response", async (resp) => {
      if (!resp.url().includes(JOB_LIST_PATH)) return
      try {
        const payload = (await resp.json()) as JobListPayload
        const v = classifyJoblist(payload)
        // An early empty response is not final — the SPA sometimes fires a
        // placeholder request before the real one. Keep waiting unless a risk
        // or login verdict demands an immediate stop.
        if (v === "risk" || v === "login") verdict = v
        if (v === "ok") {
          verdict = "ok"
          for (const j of payload.zpData?.jobList ?? []) {
            if (!seenIds.has(j.encryptJobId)) {
              seenIds.add(j.encryptJobId)
              jobs.push(j)
            }
          }
        }
      } catch {
        // ignore malformed
      }
    })

    await page.goto(buildSearchUrl(opts.city, opts.query, opts.page), { waitUntil: "domcontentloaded", timeout: 60000 })
    // The SPA fires joblist after hydration; give it time, scroll like a
    // human, and wait for the capture — bounded. 'ok' exits early; anything
    // else keeps waiting until the deadline in case the real response is late.
    const deadline = Date.now() + 30_000
    while (verdict !== "ok" && Date.now() < deadline) {
      await humanPause(1500)
      await humanScroll(page, 2).catch(() => {})
      if (verdict === "risk" || verdict === "login") break
    }
    await page.close().catch(() => {})

    if (verdict === "risk" || verdict === "login") {
      writeError(
        verdict === "risk"
          ? "Boss risk control (code 31/37): stop, complete the human verification in the Chrome window, wait a few minutes, and only then retry at a lower rate. Never auto-retry."
          : "not logged in (or session expired) - re-run `boss-search setup`",
        verdict === "risk" ? "RISK_CONTROL" : "NOT_LOGGED_IN",
      )
      return 1
    }

    let rows = jobs.map((j) => toJobResult(j, opts.city))
    if (opts.limit !== undefined && rows.length > opts.limit) rows = rows.slice(0, opts.limit)

    if (opts.format === "table") process.stdout.write(renderTable(rows) + "\n")
    else if (opts.format === "plain") process.stdout.write(renderPlain(rows) + "\n")
    else process.stdout.write(JSON.stringify({ meta: { count: rows.length, page: opts.page }, results: rows }, null, 2) + "\n")
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  } finally {
    await browser.close() // detach; the real Chrome stays up
  }
}
