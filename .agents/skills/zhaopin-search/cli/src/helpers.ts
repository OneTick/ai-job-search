// Shared helpers for the zhaopin-search CLI.
//
// Zhaopin.com (智联招聘) blocks non-browser HTTP clients by TLS fingerprint /
// bot detection ("Security Verification" interstitial), so every fetch goes
// through a real Playwright browser. The only runtime dependency is
// `playwright` — a deliberate exception to the repo's zero-dependency portal
// CLI default, documented in the README and SKILL.md.
//
// Personal use only: keep volume low, no commercial or bulk collection.

import { chromium, type Browser, type BrowserContext, type Page } from "playwright"
import { homedir } from "os"
import { join } from "path"
import { existsSync, mkdirSync, readdirSync } from "fs"

export interface JobResult {
  id: string | null
  title: string | null
  company: string | null
  location: string | null
  salary: string | null
  date: string | null // zhaopin does not expose posting dates; always null
  url: string | null
  description?: string | null // detail command only
}

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

/**
 * Set a neutral terminal/window title so a CLI run never flashes
 * "zhaopin"/"boss"/"job" in a shared or workplace-visible terminal.
 * Emitted as an OSC escape sequence; harmless where unsupported.
 */
export function setNeutralTitle(): void {
  if (process.stdout.isTTY) process.stdout.write("\x1b]0;build-tools\x07")
}

// ---------------------------------------------------------------------------
// Auth state (optional login)
//
// `login` (src/commands/login.ts) saves a logged-in storageState here so
// search/detail can see salaries (hidden behind login otherwise) and the user
// gets a working 立即投递 session. The file is gitignored; it never enters the
// repo. The phone number and SMS code are only ever typed by the user into the
// real browser window — the CLI never handles them.
// ---------------------------------------------------------------------------

export const AUTH_FILE = join(import.meta.dir, "../../.auth/state.json")

export function hasAuthState(): boolean {
  return existsSync(AUTH_FILE)
}

/**
 * Prefer the full Chromium over Playwright's headless shell: zhaopin's detail
 * pages sit behind Tencent Cloud EdgeOne, which challenges the headless shell
 * but passes the full browser binary (verified 2026-08-31). Scans the shared
 * playwright cache for the newest full-chromium build; falls back to the
 * default headless shell when none is present.
 */
function findFullChromium(): string | undefined {
  try {
    const cacheRoot = join(homedir(), ".cache", "ms-playwright")
    if (!existsSync(cacheRoot)) return undefined
    const dirs = readdirSync(cacheRoot)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort((a, b) => parseInt(b.slice(8), 10) - parseInt(a.slice(8), 10))
    for (const d of dirs) {
      for (const sub of ["chrome-linux64", "chrome-linux"]) {
        const exe = join(cacheRoot, d, sub, "chrome")
        if (existsSync(exe)) return exe
      }
    }
  } catch {
    // fall through to the default binary
  }
  return undefined
}

export async function launchBrowser(headless = true): Promise<{ browser: Browser; context: BrowserContext }> {
  const executablePath = findFullChromium()
  const browser = await chromium.launch({ headless, executablePath })
  const context = await browser.newContext({
    storageState: hasAuthState() ? AUTH_FILE : undefined,
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  })
  // Boss直聘's browser-check SDK fingerprints the browser and calls
  // window.close() on anything Playwright-ish (verified 2026-09-01: the login
  // page wipes itself to about:blank). Two minimal patches before any page
  // script runs: drop the navigator.webdriver tell, and make window.close()
  // a no-op so the page cannot kill our session. Personal-use only — this is
  // session-keeping for one's own job search, not bulk collection.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined })
    try {
      window.close = () => {}
    } catch {
      // ignore
    }
  })
  return { browser, context }
}

// ---------------------------------------------------------------------------
// City codes
//
// zhaopin's path-style search URL encodes the city as /sou/jl<code>/kw<query>.
// Only 北京 (530) has been verified live; the other codes come from zhaopin's
// public filter links and should be spot-checked before heavy use. Cities not
// in this map are rejected rather than guessed — an invented code silently
// searches the wrong city.
// ---------------------------------------------------------------------------

export const CITY_CODES: Record<string, string> = {
  北京: "530",
  上海: "538",
  广州: "635",
  深圳: "765",
  天津: "531",
  杭州: "653",
  武汉: "736",
  西安: "854",
  成都: "801",
  南京: "632",
  苏州: "636",
  全国: "",
}

// Marker text zhaopin renders when a search returns zero results (verified live
// 2026-08-31: ASCII keywords like "Java" hit this on the direct path URL, while
// percent-encoded Chinese keywords work first-try).
export const EMPTY_MARKER = "很抱歉，您搜索的职位找不到"

export function buildSearchUrl(city: string, query: string, page: number): string {
  const code = CITY_CODES[city] ?? ""
  const kw = encodeURIComponent(query)
  const jl = code ? `jl${code}/` : ""
  const p = page > 1 ? `/p${page}` : ""
  return `https://www.zhaopin.com/sou/${jl}kw${kw}${p}`
}

/**
 * Resolve the encoded-kw token URL for queries the direct path does not accept
 * (ASCII / mixed keywords). Requests the query-string entry point once and lets
 * the browser follow the 301 to /sou/jlXXX/kw<TOKEN>; returns the token URL.
 * robots.txt disallows `/*?*`, which technically covers this one entry-point
 * request — kept to a single redirect per failed search, documented in
 * SKILL.md's personal-use note.
 */
export async function resolveTokenUrl(page: Page, city: string, query: string): Promise<string | null> {
  const code = CITY_CODES[city] ?? ""
  const jl = code ? `&jl=${code}` : ""
  const entry = `https://sou.zhaopin.com/?kw=${encodeURIComponent(query)}${jl}`
  try {
    await page.goto(entry, { waitUntil: "domcontentloaded", timeout: 30000 })
    const final = page.url()
    if (/\/sou\/(jl\d+\/)?kw[^/?#]+/.test(final) && final.includes("/sou/")) return final.split("#")[0]
    return null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Card extraction
//
// Verified against live SSR markup 2026-08-31 (see url-reference.md). Card
// root: `.joblist-box__item`; title anchor `.jobinfo__name` (href carries the
// /jobdetail/<ID>.htm id plus tracking params, which are stripped — robots.txt
// disallows query-string URLs); salary `.jobinfo__salary`; the three
// `.jobinfo__other-info-item` slots are 地点 / 经验 / 学历; company
// `.companyinfo__name`. The anchor-walk fallback keeps results coming if
// zhaopin renames classes, at reduced field fidelity.
// ---------------------------------------------------------------------------

export const JOB_DETAIL_HREF = /\/jobdetail\/([A-Za-z0-9]+)\.htm/

interface RawCard {
  id: string
  href: string
  title: string | null
  salary: string | null
  location: string | null
  company: string | null
}

async function extractCardsStructured(page: Page): Promise<RawCard[]> {
  return page.evaluate((hrefRe: string) => {
    const re = new RegExp(hrefRe)
    const seen = new Set<string>()
    const cards: RawCard[] = []
    for (const card of Array.from(document.querySelectorAll(".joblist-box__item"))) {
      const root = card as HTMLElement
      const a = root.querySelector("a.jobinfo__name, a[href*='/jobdetail/']") as HTMLAnchorElement | null
      if (!a) continue
      const m = (a.getAttribute("href") ?? "").match(re)
      if (!m || seen.has(m[1])) continue
      seen.add(m[1])
      const text = (sel: string) => root.querySelector(sel)?.textContent?.trim() ?? null
      // other-info slots are ordered 地点 / 经验 / 学历; the location slot also
      // holds an <img> icon whose alt text must not leak into the value.
      const infoItems = Array.from(root.querySelectorAll(".jobinfo__other-info-item"))
      const location = infoItems[0]?.querySelector("span")?.textContent?.trim() ?? infoItems[0]?.textContent?.trim() ?? null
      cards.push({
        id: m[1],
        href: `https://www.zhaopin.com/jobdetail/${m[1]}.htm`,
        title: text("a.jobinfo__name") ?? a.textContent?.trim() ?? null,
        salary: text(".jobinfo__salary"),
        location,
        company: root.querySelector<HTMLElement>(".companyinfo__name")?.title ?? text(".companyinfo__name"),
      })
    }
    return cards
  }, JOB_DETAIL_HREF.source)
}

/** Anchor-walk fallback: /jobdetail/ anchors only, heuristically split fields. */
async function extractCardsFallback(page: Page): Promise<RawCard[]> {
  return page.evaluate((hrefRe: string) => {
    const re = new RegExp(hrefRe)
    const seen = new Set<string>()
    const cards: RawCard[] = []
    for (const a of Array.from(document.querySelectorAll("a[href]")) as HTMLAnchorElement[]) {
      const m = (a.getAttribute("href") ?? "").match(re)
      if (!m || seen.has(m[1])) continue
      seen.add(m[1])
      let card: HTMLElement | null = a
      for (let i = 0; i < 5 && card.parentElement; i++) {
        card = card.parentElement
        if (card.querySelectorAll("a[href*='/jobdetail/']").length >= 2) break
      }
      const t = (card?.textContent ?? "").replace(/\s+/g, " ").trim()
      cards.push({
        id: m[1],
        href: `https://www.zhaopin.com/jobdetail/${m[1]}.htm`,
        title: a.textContent?.trim() ?? null,
        salary: t.match(/[\d.]+\s*[-–~]\s*[\d.]+\s*[万千]?\s*元?(?:[·x×]\d+薪)?/)?.[0] ?? null,
        location: t.match(/(北京|上海|广州|深圳|天津|杭州|武汉|西安|成都|南京|苏州)([·][^,，。]*)?/)?.[0] ?? null,
        company: null,
      })
    }
    return cards
  }, JOB_DETAIL_HREF.source)
}

export async function extractCards(page: Page): Promise<RawCard[]> {
  const structured = await extractCardsStructured(page)
  if (structured.length > 0) return structured
  return extractCardsFallback(page)
}

/** Map a raw card to the contract JobResult (company falls back to id-tagged null). */
export function parseCard(raw: RawCard): JobResult {
  return {
    id: raw.id,
    title: raw.title,
    company: raw.company,
    location: raw.location,
    salary: raw.salary,
    date: null,
    url: raw.href,
  }
}

// ---------------------------------------------------------------------------
// Output rendering (same conventions as the other portal CLIs)
// ---------------------------------------------------------------------------

export function renderTable(rows: JobResult[]): string {
  if (rows.length === 0) return "No results."
  const columns: Array<{ header: string; width: number; cell: (r: JobResult) => string }> = [
    { header: "ID", width: 28, cell: (r) => r.id ?? "—" },
    { header: "TITLE", width: 36, cell: (r) => r.title ?? "—" },
    { header: "COMPANY", width: 24, cell: (r) => r.company ?? "—" },
    { header: "LOCATION", width: 18, cell: (r) => r.location ?? "—" },
    { header: "SALARY", width: 16, cell: (r) => r.salary ?? "—" },
  ]
  const row = (cells: string[]) => cells.map((c, i) => c.slice(0, columns[i].width).padEnd(columns[i].width)).join("  ")
  const header = row(columns.map((c) => c.header))
  return [header, "-".repeat(header.length), ...rows.map((r) => row(columns.map((c) => c.cell(r))))].join("\n")
}

export function renderPlain(rows: JobResult[]): string {
  if (rows.length === 0) return "No results."
  return rows
    .map((r) => [r.title ?? "—", `  ${r.company ?? "—"} · ${r.location ?? "—"} · ${r.salary ?? "—"}`, `  id: ${r.id}`, `  ${r.url}`].join("\n"))
    .join("\n\n")
}

export function ensureAuthDir(): void {
  const dir = join(AUTH_FILE, "..")
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}
