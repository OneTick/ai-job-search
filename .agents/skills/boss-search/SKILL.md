---
name: boss-search
version: 1.0.0
description: >
  Use this skill to search jobs on Boss直聘 (zhipin.com) — China's largest
  job board, primary channel for 京东 / 百度 / 美团 / 字节跳动 postings in
  Beijing and other Chinese cities. Attaches to a real logged-in Chrome over
  CDP (community-validated approach to Boss's anti-bot stack). Trigger
  phrases: Boss直聘, BOSS招聘, 找工作 boss, search Boss zhipin, boss job
  search, look up this boss job posting.
context: fork
enabled: true
allowed-tools: Bash(bun run .agents/skills/boss-search/cli/src/cli.ts *)
---

# Boss Search Skill (Boss直聘)

Search Boss直聘 — the primary Chinese job board for internet-company roles.
**Requires a one-time interactive login** (`setup` command); after that,
searches attach to the same real Chrome over CDP.

## ⚠️ Personal use only — and this portal is strict

Boss's user agreement prohibits bulk/automated collection, and Boss runs the
strictest anti-bot stack of the Chinese boards: browser fingerprinting that
wipes pages to about:blank under automation, cumulative client flagging, and
risk codes 31/37. This skill deliberately does NOT use Playwright-controlled
or headless browsers — it attaches to a **real Chrome** (Windows Chrome via
WSL interop, or linux google-chrome) with an isolated persistent profile,
navigates real search pages, and passively captures the `joblist.json`
responses the page itself issues. Zero injected requests (injected fetches
are the documented code-37 trap).

Operational rules (enforced in code):
- One page per search call, human-paced scrolling, **≥60s between calls**
  (observed 2026-09-01: ~14s spacing gets soft-throttled into empty code-0
  responses; 60s recovers. The throttle accumulates — after many navigations,
  cool down longer).
- Risk-control hit (code 31/37) → the run STOPS with `RISK_CONTROL`.
  Complete the human verification in the Chrome window, wait a few minutes,
  lower the rate. **Never auto-retry a risk-control hit.**
- Keep total volume to a handful of searches per day.

## Commands

### One-time setup (login)

```bash
bun run .agents/skills/boss-search/cli/src/cli.ts setup
```

Launches the isolated real Chrome (separate profile — your daily browser is
untouched), opens the login page, and polls until a live probe returns real
jobs. Complete the login yourself in the window (Boss App QR scan is easiest;
手机号+短信验证码 works too — the code lands on your phone, the CLI never
touches it). The profile persists the login.

### Search

```bash
bun run .agents/skills/boss-search/cli/src/cli.ts search -q "<关键词>" -l "<城市>" [flags]
```

- `--query`/`-q` — required.
- `--location`/`-l` — 全国 北京 上海 广州 深圳 杭州, or a raw 9-digit city
  code. Default 北京.
- `--page <n>` — 1-indexed (30 results/page). `--limit`/`-n` — client-side
  cap. `--format json|table|plain` — default json.
- `--jobage` is not supported (Boss shows 活跃时间, not publish dates).

Results come from the page's own API responses: plaintext salary
(`salaryDesc` — no font-obfuscation to undo), skills, experience, degree,
boss name/title/active status.

### Detail

```bash
bun run .agents/skills/boss-search/cli/src/cli.ts detail "<url from search results>" [--format json|plain]
```

**Pass the URL exactly as emitted by search results** — it carries the `lid`
tracking param the detail page requires; a bare encryptJobId serves the
"Oops" page (`NEEDS_LID` error). Navigates the real detail page in the
attached Chrome and extracts the rendered JD text.

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — `{ meta: { count, page }, results: [...] }` with id/title/company/location/salary/skills/experience/boss/active |
| `table` | Quick scanning |
| `plain` | Reading one job's detail |

## Usage examples

```bash
# 首次（一次即可）
bun run .agents/skills/boss-search/cli/src/cli.ts setup

# 北京的 Java 架构师
bun run .agents/skills/boss-search/cli/src/cli.ts search -q "Java 架构师" -l 北京 --format table

# 美团的岗位
bun run .agents/skills/boss-search/cli/src/cli.ts search -q "美团 Java" -l 北京 -n 10
```

## Notes

- **No publish dates.** `date` is always null; Boss shows recruiter activity
  (`activeTimeDesc`) instead.
- **City codes.** Only the six listed cities are hardcoded; unknown cities
  error out (pass a 9-digit code from Boss's own URLs if needed).
- **CDP endpoint.** Port 9222; if your daily Chrome already runs with a
  debugger on that port, setup refuses — pick a different machine state or
  stop it first.
- **The real Chrome must stay running** for search/detail to attach. `setup`
  leaves it open; closing the window means re-running setup.
- **WSL2 note.** With Windows Chrome, CDP binds on the Windows side; WSL
  mirrored networking (Win11 default) reaches it at 127.0.0.1. NAT-mode WSL
  needs a portproxy — prefer mirrored, or install linux google-chrome.
- **Terminal title.** Neutral `build-tools` title is set on every run.
- Markup/endpoint changes: see `url-reference.md`.
