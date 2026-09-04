// Dump any zhaopin page's structure: title, class census, timing, HTML sample.
// Diagnostic only — not part of the CLI contract. Uses the CLI's own
// launchBrowser (full-chromium preference, auth state) so it sees what the
// CLI sees.
import { launchBrowser } from "./src/helpers.js"

const url = process.argv[2] ?? "https://www.zhaopin.com/sou/jl530/kw%E6%9E%B6%E6%9E%84%E5%B8%88"

const { browser, context } = await launchBrowser(true)
const page = await context.newPage()
const t0 = Date.now()
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 })
// Give client-side rendering a window, then report both snapshots.
await page.waitForTimeout(6000)

const info = await page.evaluate(() => {
  const classes = new Map<string, number>()
  document.querySelectorAll("*").forEach((el) => {
    (el.classList || []).forEach((c) => classes.set(c, (classes.get(c) ?? 0) + 1))
  })
  const h1 = document.querySelector("h1")?.textContent?.trim() ?? null
  const bodyLen = (document.body?.innerText ?? "").length
  return {
    docTitle: document.title,
    h1,
    bodyLen,
    url: location.href,
    topClasses: Array.from(classes.entries()).sort((a, b) => b[1] - a[1]).slice(0, 50),
    bodySample: (document.body?.innerText ?? "").slice(0, 1500),
  }
})

console.log(JSON.stringify({ elapsedMs: Date.now() - t0, ...info }, null, 2))
await browser.close()
