// Probe: enter zhipin.com via the home page and click 登录 (natural flow),
// instead of deep-linking the login page which self-destructs.
import { launchBrowser } from "./src/helpers.js"

const headed = process.argv[2] !== "headless"
const { browser, context } = await launchBrowser(headed)
const page = await context.newPage()
page.on("framenavigated", (f) => {
  if (f === page.mainFrame()) console.error(`[nav] ${f.url().slice(0, 120)}`)
})

console.error(`[step] goto homepage`)
await page.goto("https://www.zhipin.com/", { waitUntil: "domcontentloaded", timeout: 45000 })
await page.waitForTimeout(5000)
console.error(`[step] url=${page.url().slice(0, 100)} title=${await page.title()}`)
const bodyLen = await page.evaluate(() => (document.body?.innerText ?? "").length).catch(() => -1)
console.error(`[step] bodyLen=${bodyLen}`)
if (bodyLen < 50) {
  console.error("[step] homepage blank too — IP/环境已被标记")
} else {
  console.error(`[step] body sample: ${(await page.evaluate(() => document.body.innerText.slice(0, 300))).replace(/\n+/g, " | ")}`)
  const loginBtn = page.locator("text=登录").first()
  if (await loginBtn.count()) {
    console.error("[step] clicking 登录")
    await loginBtn.click().catch((e) => console.error(`[click error] ${e}`))
    await page.waitForTimeout(6000)
    console.error(`[step] after click url=${page.url().slice(0, 120)} title=${await page.title()}`)
    const len2 = await page.evaluate(() => (document.body?.innerText ?? "").length).catch(() => -1)
    console.error(`[step] after click bodyLen=${len2}`)
    if (len2 > 0) console.error(`[step] sample: ${(await page.evaluate(() => document.body.innerText.slice(0, 300))).replace(/\n+/g, " | ")}`)
  } else {
    console.error("[step] no 登录 button found")
  }
}
await page.screenshot({ path: "/tmp/boss-probe.png" }).catch(() => {})
await browser.close()
