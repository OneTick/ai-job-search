// login command — one-off interactive login that saves a storageState the
// search/detail commands reuse. Opens a HEADED browser; the user completes
// zhaopin's login (QR scan or 手机号 + 短信验证码) themselves in that window.
// The CLI never sees the phone number or the SMS code — it only saves cookies.
//
// WSL2 note: needs WSLg (Windows 11) for the headed window. If no display is
// available, run this from a Windows-side terminal instead.

import { launchBrowser, AUTH_FILE, ensureAuthDir, writeError } from "../helpers.js"

export async function runLogin(): Promise<number> {
  ensureAuthDir()
  console.error("正在打开浏览器进行智联登录（二维码或手机号+验证码均可在窗口内完成）...")
  console.error("登录成功后此命令会自动保存会话并退出；最长等待 3 分钟。")

  const { browser, context } = await launchBrowser(false)
  try {
    const page = await context.newPage()
    await page.goto("https://www.zhaopin.com/", { waitUntil: "domcontentloaded", timeout: 45000 })

    // Logged-in marker: the header switches from "登录/注册" to the user's
    // avatar/menu. Poll instead of a hard selector — zhaopin's header markup
    // is not stable.
    const deadline = Date.now() + 180_000
    let loggedIn = false
    while (Date.now() < deadline) {
      loggedIn = await page.evaluate(() => {
        const body = document.body?.innerText ?? ""
        return !/登录\/注册/.test(body) && /我的|简历|投递/.test(body)
      })
      if (loggedIn) break
      await page.waitForTimeout(3000)
    }

    if (!loggedIn) {
      writeError("180 秒内未检测到登录成功；如未完成请重试 login", "LOGIN_TIMEOUT")
      return 1
    }

    await context.storageState({ path: AUTH_FILE })
    console.error(`已保存登录状态到 ${AUTH_FILE}（该文件在 .gitignore 中，不会入库）`)
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "LOGIN_FAILED")
    return 1
  } finally {
    await browser.close()
  }
}
