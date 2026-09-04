// Probe: does visiting the (reliably-passing) search page first, then the
// detail page in the SAME context, clear the EdgeOne challenge?
import { launchBrowser } from "./src/helpers.js"

const detailUrl = process.argv[2] ?? "https://www.zhaopin.com/jobdetail/CC383625320J40880647109.htm"
const warmupUrl = "https://www.zhaopin.com/sou/jl530/kw%E6%9E%B6%E6%9E%84%E5%B8%88"

const { browser, context } = await launchBrowser(true)
const page = await context.newPage()

console.error("[step] warmup: search page")
await page.goto(warmupUrl, { waitUntil: "domcontentloaded", timeout: 45000 })
await page.waitForTimeout(3000)
const warmBody = await page.evaluate(() => document.body?.innerText.slice(0, 80) ?? "")
console.error(`[step] warmup body: ${warmBody.replace(/\n+/g, " | ")}`)

for (let i = 1; i <= 3; i++) {
  console.error(`[step] detail attempt ${i}`)
  await page.goto(detailUrl, { waitUntil: "domcontentloaded", timeout: 45000 })
  await page.waitForTimeout(3000)
  const body = await page.evaluate(() => document.body?.innerText ?? "")
  const challenged = body.includes("Security Verification") || body.includes("正在验证")
  console.error(`[step] attempt ${i}: challenged=${challenged} bodyLen=${body.length}`)
  if (!challenged) {
    console.error(`[step] sample: ${body.slice(0, 300).replace(/\n+/g, " | ")}`)
    break
  }
  await page.waitForTimeout(4000)
}
await browser.close()
