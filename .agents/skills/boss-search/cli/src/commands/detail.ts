// detail command — navigate the real job detail page in the attached Chrome
// and extract the visible JD text from the rendered DOM (the page is fully
// client-rendered; scraping the DOM the browser already built is fine — the
// anti-bot surface is injected network requests, not rendered-content reads).

import { attachChrome, humanPause, humanScroll, writeError } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

const JOB_DETAIL_URL_RE = /(?:https?:\/\/[^/]*zhipin\.com)?\/job_detail\/([A-Za-z0-9_~]+)\.html/

export async function runDetail(opts: DetailOpts): Promise<number> {
  const m = opts.id.match(JOB_DETAIL_URL_RE)
  const id = m ? m[1] : /^[A-Za-z0-9_~]+$/.test(opts.id) ? opts.id : null
  if (!id) {
    writeError(`cannot parse a Boss job id out of "${opts.id}" (expected an encryptJobId or a /job_detail/<ID>.html URL)`, "BAD_ID")
    return 1
  }
  const url = `https://www.zhipin.com/job_detail/${id}.html`

  const session = await attachChrome()
  if (!session) {
    writeError("no running Chrome with CDP on port 9222 - run `boss-search setup` first", "NO_CDP")
    return 1
  }
  const { browser, context } = session
  try {
    const page = await context.newPage()
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 })
    await humanPause(4000)
    await humanScroll(page, 3).catch(() => {})

    const detail = await page.evaluate(() => {
      const text = (sel: string) => document.querySelector(sel)?.textContent?.trim() ?? null
      const isOops = /Oops|页面不存在|职位已下线/.test(document.body?.innerText.slice(0, 500) ?? "")
      if (isOops) return { oops: true as const, name: null, salary: null, company: null, location: null, description: null }
      const name = text(".job-banner .name, .name, h1") ?? document.title.split("-")[0]?.trim() ?? null
      const salary = text(".job-banner .salary, .salary, .badge")?.match(/[\d.]+\s*[-–~]\s*[\d.]*\s*[Kk万]?/)?.[0] ?? null
      const company = text(".company-info .name, .company, [ka='job-detail-company']") ?? null
      const location = text(".job-banner .location, .location-address") ?? null
      // JD container: Boss renders the description under .job-sec-text or .detail-content
      const desc =
        text(".job-sec-text") ??
        text(".detail-content") ??
        (Array.from(document.querySelectorAll("div, section"))
          .filter((el) => (el.textContent ?? "").trim().length > 300 && !el.querySelector("[class*='sec-text'] > div > div > div > div"))
          .sort((a, b) => (a.textContent ?? "").length - (b.textContent ?? "").length)[0]?.textContent ?? null)
      return { oops: false as const, name, salary, company, location, description: desc?.replace(/\n{3,}/g, "\n\n").trim() ?? null }
    })
    await page.close().catch(() => {})

    if (detail.oops) {
      writeError(
        'Boss served the "Oops" page - a bare encryptJobId is not enough, the detail URL needs its `lid` tracking param. Use the URL exactly as emitted in search results (`"url": "https://www.zhipin.com/job_detail/<ID>.html?lid=..."`).',
        "NEEDS_LID",
      )
      return 1
    }

    const result = { id, title: detail.name, company: detail.company, location: detail.location, salary: detail.salary, date: null, url, description: detail.description }
    if (opts.format === "plain") {
      process.stdout.write(
        [
          result.title ?? "—",
          `  ${result.company ?? "—"} · ${result.location ?? "—"} · ${result.salary ?? "—"}`,
          `  id: ${result.id}`,
          `  ${result.url}`,
          "",
          result.description ?? "（描述未提取到）",
        ].join("\n") + "\n",
      )
    } else {
      process.stdout.write(JSON.stringify(result, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  } finally {
    await browser.close()
  }
}
