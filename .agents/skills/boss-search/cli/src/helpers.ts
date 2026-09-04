// Shared helpers for the boss-search CLI.
//
// Boss直聘 runs the strictest anti-bot stack of the Chinese boards: browser
// fingerprinting (console.table probing, browser-check SDK) that wipes pages
// to about:blank under automation, cumulative client flagging, and risk codes
// 31/37 on injected requests. The community-validated approach (see
// eatmoreduck/boss-zhipin-scraper, 1269★) is: attach to a REAL Chrome via CDP,
// reuse its persistent login state, navigate REAL search pages, and passively
// capture the joblist.json responses the page itself issues — zero injected
// requests, no headless/controlled browsers. This CLI implements exactly that.
//
// Personal use only: keep volume low (one page per search call, human-paced),
// never commercial or bulk. Risk-control hits (codes 31/37) STOP the run and
// ask for a human — never auto-retried.

import { chromium, type Browser, type Page } from "playwright"
import { existsSync } from "fs"
import { homedir, platform } from "os"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

/** Neutral terminal/window title — never flash "boss"/"job" in a visible terminal. */
export function setNeutralTitle(): void {
  if (process.stdout.isTTY) process.stdout.write("\x1b]0;build-tools\x07")
}

// ---------------------------------------------------------------------------
// Chrome discovery + launch (setup command)
//
// Preference order: Windows Chrome via WSL interop (genuine Windows browser,
// best fingerprint) > linux google-chrome > /opt/google/chrome. The profile is
// ISOLATED from the user's daily browser and persists the login.
// ---------------------------------------------------------------------------

const CDP_PORT = 9222

async function windowsUserProfile(): Promise<string | null> {
  const cmd = "/mnt/c/Windows/System32/cmd.exe"
  if (!existsSync(cmd)) return null
  const proc = Bun.spawn([cmd, "/c", "echo %USERPROFILE%"], { stdout: "pipe" })
  const out = (await new Response(proc.stdout).text()).trim()
  return out && !out.includes("%") ? out : null
}

export interface ChromeTarget {
  /** Command to launch (argv[0]); args appended. */
  cmd: string
  /** user-data-dir argument in the form the target OS expects. */
  userDataDir: string
  /** Windows-side launches need to keep running detached; handled by caller. */
  viaInterop: boolean
}

export async function findChrome(): Promise<ChromeTarget | null> {
  const candidates: ChromeTarget[] = []
  // Linux google-chrome first: its CDP binds on this host's localhost, which
  // is where the CLI looks. Windows Chrome via WSL interop is a fallback —
  // its CDP binds on the Windows side and is only reachable under WSL
  // mirrored networking (NAT-mode WSL cannot reach it; portproxy is the
  // workaround, see url-reference.md).
  for (const p of ["google-chrome", "google-chrome-stable", "/opt/google/chrome/chrome"]) {
    const proc = Bun.spawn(["which", p], { stdout: "pipe", stderr: "pipe" })
    if ((await proc.exited) === 0) {
      const resolved = (await new Response(proc.stdout).text()).trim()
      candidates.push({ cmd: resolved, userDataDir: `${homedir()}/.boss-cdp-profile`, viaInterop: false })
      break
    }
  }
  if (candidates.length === 0) {
    const interopProfile = await windowsUserProfile()
    if (interopProfile) {
      for (const p of [
        "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe",
        "/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe",
      ]) {
        if (existsSync(p)) {
          candidates.push({ cmd: p, userDataDir: `${interopProfile}\\boss-cdp-profile`, viaInterop: true })
        }
      }
    }
  }
  return candidates[0] ?? null
}

export function chromeArgs(userDataDir: string): string[] {
  const args = [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-allow-origins=*",
  ]
  // Chrome refuses to start as root without this (WSL default-user case).
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    args.push("--no-sandbox", "--disable-dev-shm-usage")
  }
  return args
}

export const cdpEndpoint = () => `http://127.0.0.1:${CDP_PORT}`

/** Attach to the already-running real Chrome; null when it is not up. */
export async function attachChrome(): Promise<{ browser: Browser; context: BrowserContextOf } | null> {
  try {
    const browser = await chromium.connectOverCDP(cdpEndpoint(), { timeout: 5000 })
    const context = browser.contexts()[0]
    if (!context) return null
    return { browser, context }
  } catch {
    return null
  }
}
type BrowserContextOf = Awaited<ReturnType<Browser["newContext"]>>

// ---------------------------------------------------------------------------
// Human-paced behavior (the anti-automation surface is behavior, not crypto)
// ---------------------------------------------------------------------------

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** Human-ish pause between page-level actions: base ± jitter. */
export const humanPause = (baseMs: number) => sleep(baseMs + Math.floor(Math.random() * baseMs * 0.6))

/** Scroll like a reader: random wheel steps with pauses, occasional up-scroll. */
export async function humanScroll(page: Page, rounds = 3): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    const dist = 300 + Math.floor(Math.random() * 500)
    await page.mouse.wheel(0, dist).catch(() => {})
    await humanPause(800)
    if (Math.random() < 0.25) {
      await page.mouse.wheel(0, -120).catch(() => {})
      await humanPause(500)
    }
  }
}

// ---------------------------------------------------------------------------
// Search URL + response classification
// ---------------------------------------------------------------------------

export const JOB_LIST_PATH = "/wapi/zpgeek/search/joblist.json"

export const CITY_CODES: Record<string, string> = {
  全国: "100010000",
  北京: "101010100",
  上海: "101020100",
  广州: "101280100",
  深圳: "101280600",
  杭州: "101210100",
}

export function buildSearchUrl(city: string, query: string, page: number): string {
  const code = CITY_CODES[city] ?? (/^\d{9}$/.test(city) ? city : CITY_CODES["北京"])
  const params = new URLSearchParams({ query, city: code, page: String(page), pageSize: "30" })
  return `https://www.zhipin.com/web/geek/job/?${params.toString()}`
}

export interface BossJob {
  encryptJobId: string
  jobName: string
  brandName: string
  cityDistrict?: string
  areaDistrict?: string
  businessDistrict?: string
  salaryDesc: string
  jobLabels?: string[]
  skills?: string[]
  jobExperience?: string
  jobDegree?: string
  bossName?: string
  bossTitle?: string
  activeTimeDesc?: string
  lid?: string
}

export interface JobListPayload {
  code: number
  message?: string
  zpData?: { jobList?: BossJob[]; hasMore?: boolean }
}

/** Boss risk-control codes: 31 = 访问环境异常, 37 = 注入请求/环境异常. */
export const RISK_CODES = new Set([31, 37])

export function classifyJoblist(payload: JobListPayload): "ok" | "risk" | "login" | "empty" {
  if (RISK_CODES.has(payload.code)) return "risk"
  if (payload.code !== 0) return "login"
  if ((payload.zpData?.jobList ?? []).length === 0) return "empty"
  return "ok"
}

export function toJobResult(j: BossJob, city: string) {
  const location = [j.cityDistrict, j.areaDistrict, j.businessDistrict].filter(Boolean).join("·") || city
  return {
    id: j.encryptJobId,
    title: j.jobName ?? null,
    company: j.brandName ?? null,
    location,
    salary: j.salaryDesc ?? null,
    date: null,
    url: `https://www.zhipin.com/job_detail/${j.encryptJobId}.html${j.lid ? `?lid=${j.lid}` : ""}`,
    labels: j.jobLabels ?? [],
    skills: j.skills ?? [],
    experience: j.jobExperience ?? null,
    degree: j.jobDegree ?? null,
    boss: j.bossName ? `${j.bossName}·${j.bossTitle ?? ""}` : null,
    active: j.activeTimeDesc ?? null,
  }
}

// ---------------------------------------------------------------------------
// Output rendering (contract-compatible with the other portal CLIs)
// ---------------------------------------------------------------------------

type Row = ReturnType<typeof toJobResult>

export function renderTable(rows: Row[]): string {
  if (rows.length === 0) return "No results."
  const columns: Array<{ header: string; width: number; cell: (r: Row) => string }> = [
    { header: "ID", width: 24, cell: (r) => r.id ?? "—" },
    { header: "TITLE", width: 34, cell: (r) => r.title ?? "—" },
    { header: "COMPANY", width: 22, cell: (r) => r.company ?? "—" },
    { header: "LOCATION", width: 16, cell: (r) => r.location ?? "—" },
    { header: "SALARY", width: 14, cell: (r) => r.salary ?? "—" },
  ]
  const row = (cells: string[]) => cells.map((c, i) => c.slice(0, columns[i].width).padEnd(columns[i].width)).join("  ")
  const header = row(columns.map((c) => c.header))
  return [header, "-".repeat(header.length), ...rows.map((r) => row(columns.map((c) => c.cell(r))))].join("\n")
}

export function renderPlain(rows: Row[]): string {
  if (rows.length === 0) return "No results."
  return rows
    .map((r) =>
      [
        r.title ?? "—",
        `  ${r.company ?? "—"} · ${r.location ?? "—"} · ${r.salary ?? "—"}`,
        `  ${r.experience ?? ""}${r.degree ? " / " + r.degree : ""}${r.skills?.length ? " · 技能: " + r.skills.join(",") : ""}`,
        `  id: ${r.id}`,
        `  ${r.url}`,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n")
}

export const isWindows = () => platform() === "win32"
