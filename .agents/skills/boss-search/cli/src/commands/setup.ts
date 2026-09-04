// setup command — launch the isolated real Chrome (persistent profile), open
// the login page, and poll until the login actually works (probe = real search
// page yields jobList with plaintext salaryDesc). Run ONCE; the profile keeps
// the login for later search/detail calls.
//
// The user completes the login themselves in the opened window (QR scan from
// the Boss app is easiest; 手机号+短信验证码 also works). The CLI never sees
// credentials — it only watches for the probe to come back clean.

import {
  attachChrome,
  buildSearchUrl,
  cdpEndpoint,
  chromeArgs,
  findChrome,
  humanPause,
  JOB_LIST_PATH,
  writeError,
  type JobListPayload,
} from "../helpers.js"
import { spawn } from "child_process"

const LOGIN_URL = "https://www.zhipin.com/web/user/?from=login"
const SETUP_TIMEOUT_MS = 300_000

async function waitForCdp(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${cdpEndpoint()}/json/version`)
      if (res.ok) return true
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1500))
  }
  return false
}

export async function runSetup(): Promise<number> {
  console.error("[setup] 查找真实 Chrome...")
  const chrome = await findChrome()
  if (!chrome) {
    writeError(
      "no real Chrome found (expected Windows Chrome via WSL interop or linux google-chrome); install one and retry",
      "NO_CHROME",
    )
    return 1
  }
  console.error(`[setup] Chrome: ${chrome.cmd}`)

  // Already running? Attach and go straight to probing.
  const existing = await attachChrome()
  if (existing) {
    console.error("[setup] CDP 端口已有 Chrome 在运行，直接进入登录探测")
    await existing.browser.close()
    return probeLoop()
  }

  console.error("[setup] 启动隔离 Chrome（独立 profile，不影响你日常的浏览器）...")
  const child = spawn(chrome.cmd, chromeArgs(chrome.userDataDir), {
    detached: true,
    stdio: "ignore",
  }).unref()

  if (!(await waitForCdp(30_000))) {
    writeError(
      "Chrome launched but CDP endpoint did not come up on port 9222 within 30s; check that no other Chrome instance owns the port",
      "CDP_TIMEOUT",
    )
    return 1
  }
  console.error("[setup] CDP 已就绪")

  // Navigate the real browser to the login page via CDP.
  const session = await attachChrome()
  if (session) {
    const page = await session.context.newPage()
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {})
  }

  console.error("[setup] 请在弹出的 Chrome 窗口里完成登录（推荐 Boss App 扫码；手机号+短信验证码也可以）。")
  console.error(`[setup] 最长等待 ${Math.round(SETUP_TIMEOUT_MS / 60000)} 分钟，登录成功会自动确认。`)
  return probeLoop()
}

/** Probe: navigate a real search page, passively watch for joblist responses. */
async function probeOnce(): Promise<"ok" | "risk" | "pending"> {
  const session = await attachChrome()
  if (!session) return "pending"
  const { browser, context } = session
  try {
    const page = await context.newPage()
    let verdict: "ok" | "risk" | "pending" = "pending"
    const onResp = (payload: JobListPayload) => {
      if (payload.code === 0 && (payload.zpData?.jobList ?? []).length > 0) verdict = "ok"
      else if (payload.code === 31 || payload.code === 37) verdict = "risk"
    }
    page.on("response", async (resp) => {
      if (!resp.url().includes(JOB_LIST_PATH) || verdict !== "pending") return
      try {
        onResp((await resp.json()) as JobListPayload)
      } catch {
        // ignore malformed
      }
    })
    await page.goto(buildSearchUrl("北京", "Java", 1), { waitUntil: "domcontentloaded", timeout: 45000 })
    await humanPause(4000)
    await page.close()
    return verdict
  } catch {
    return "pending"
  } finally {
    await browser.close() // detach CDP only; the real Chrome keeps running
  }
}

async function probeLoop(): Promise<number> {
  const deadline = Date.now() + SETUP_TIMEOUT_MS
  let interval = 8000
  while (Date.now() < deadline) {
    const verdict = await probeOnce()
    if (verdict === "ok") {
      console.error("[setup] 登录确认成功！之后可直接运行 search / detail。")
      return 0
    }
    if (verdict === "risk") {
      console.error("[setup] 命中风控（code 31/37）——请在 Chrome 窗口里完成人机验证后重跑 setup")
      writeError("risk control hit during login probe; complete the human verification in the Chrome window, then re-run setup", "RISK_CONTROL")
      return 1
    }
    await humanPause(interval)
    interval = Math.min(interval * 1.5, 15_000)
  }
  writeError("login not confirmed within the timeout; if you already logged in, re-run setup to re-probe", "LOGIN_TIMEOUT")
  return 1
}
