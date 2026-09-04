// detail command — fetch one zhaopin posting's detail page through a real
// browser and extract the structured fields. Salaries stay null unless a
// logged-in storageState exists (zhaopin hides them behind login).

import { launchBrowser, writeError, type JobResult } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

const JOB_DETAIL_URL_RE = /(?:https?:\/\/[^/]*zhaopin\.com)?\/jobdetail\/([A-Za-z0-9]+)\.htm/

export async function runDetail(opts: DetailOpts): Promise<number> {
  const m = opts.id.match(JOB_DETAIL_URL_RE)
  const id = m ? m[1] : /^[A-Za-z0-9]+$/.test(opts.id) ? opts.id : null
  if (!id) {
    writeError(`cannot parse a zhaopin job id out of "${opts.id}" (expected e.g. CC383625320J40882381309 or a /jobdetail/<ID>.htm URL)`, "BAD_ID")
    return 1
  }
  const url = `https://www.zhaopin.com/jobdetail/${id}.htm`

  const isChallenge = (body: string) => body.includes("Security Verification") || body.includes("正在验证")

  // EdgeOne challenges detail pages probabilistically (verified 2026-08-31:
  // the same browser passes one request and gets challenged the next). Handle
  // it: reload in-place a few times, then relaunch the browser once — a
  // challenge that survives that is an answer, not a transport error.
  let job: JobResult | null = null
  for (let attempt = 0; attempt < 2 && job === null; attempt++) {
    const { browser, context } = await launchBrowser(true)
    try {
      const page = await context.newPage()
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 })
      for (let round = 0; round < 3; round++) {
        const body = (await page.evaluate(() => document.body?.innerText ?? "")) ?? ""
        if (!isChallenge(body)) break
        await page.waitForTimeout(5000)
        await page.reload({ waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {})
      }
      const body = (await page.evaluate(() => document.body?.innerText ?? "")) ?? ""
      if (isChallenge(body)) continue // relaunch and try once more

      await page.waitForSelector("h1", { timeout: 20000 }).catch(() => {})

      job = await page.evaluate(
        (jobId: string): JobResult => {
          const text = (sel: string) => document.querySelector(sel)?.textContent?.trim() ?? null
          // Anchors are best-effort — zhaopin's detail markup is not stable, so
          // fall back to the page <title> and body text.
          const title = text("h1") ?? document.title.split("【")[0]?.trim() ?? null
          const company = text("[class*='company'] a") ?? text("[class*='comname']") ?? null
          const salaryRaw = text("[class*='salary']")
          const salary = salaryRaw?.match(/[\d.]+\s*[-–~]?\s*[\d.]*\s*[万千]?\s*元?(?:[·x×]\d+薪)?/)?.[0] ?? null
          const location = text("[class*='location'], [class*='address']") ?? null
          // The description block: deepest text container that still holds a
          // substantial body (leaf of the header-wrapping div chain).
          const blocks = Array.from(document.querySelectorAll("div, section")).filter(
            (el) => (el.textContent ?? "").trim().length > 200 && el.children.length > 0,
          )
          const desc =
            blocks.sort((a, b) => (a.textContent ?? "").length - (b.textContent ?? "").length).find((el) => !el.querySelector("div, section"))?.textContent ?? null
          return {
            id: jobId,
            title,
            company,
            location,
            salary,
            date: null,
            url: `https://www.zhaopin.com/jobdetail/${jobId}.htm`,
            description: desc?.replace(/[ \t]+\n/g, "\n").trim() ?? null,
          }
        },
        id,
      )
    } finally {
      await browser.close()
    }
  }

  if (job === null) {
    writeError("zhaopin kept challenging this detail page (Tencent EdgeOne) after reloads and a relaunch; wait a bit and retry, or lower the request rate", "BOT_WALL")
    return 1
  }

  if (opts.format === "plain") {
    const body = [
      job.title ?? "—",
      `  ${job.company ?? "—"} · ${job.location ?? "—"} · ${job.salary ?? "—（登录后可见）"}`,
      `  id: ${job.id}`,
      `  ${job.url}`,
      "",
      job.description ?? "（描述未提取到）",
    ].join("\n")
    process.stdout.write(body + "\n")
  } else {
    process.stdout.write(JSON.stringify(job, null, 2) + "\n")
  }
  return 0
}
