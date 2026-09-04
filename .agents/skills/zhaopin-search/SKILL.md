---
name: zhaopin-search
version: 1.0.0
description: >
  Use this skill to search for jobs on 智联招聘 (zhaopin.com) — China's major
  job board covering Beijing and other Chinese cities, including postings from
  京东 / 百度 / 美团 / 字节跳动 and other Chinese internet companies. Trigger
  phrases: 智联招聘, 找工作, 搜职位, search Zhaopin, find jobs in China,
  北京 jobs, zhaopin job search, look up this zhaopin job posting.
context: fork
enabled: true
allowed-tools: Bash(bun run .agents/skills/zhaopin-search/cli/src/cli.ts *)
---

# Zhaopin Search Skill (智联招聘)

Search live job listings from **zhaopin.com** — one of China's largest job
boards and the only major domestic board that works for automated search:
its path-style search URLs are publicly viewable without login and render
server-side. Covers Beijing first (this fork's market) plus a small set of
verified cities.

## ⚠️ Personal use only

Zhaopin's terms prohibit bulk/automated collection, and its bot detection
blocks non-browser clients. This skill drives a **real browser** (Playwright +
Chromium) — keep volume low (a handful of searches per run), never use it
commercially or for bulk data collection. Run it on your own responsibility.
robots.txt disallows query-string URLs; the CLI uses path-style search URLs,
and touches the query-string entry point (`sou.zhaopin.com/?kw=...`) only as a
single-redirect fallback when an ASCII keyword fails on the direct path.

## Why a browser (not plain fetch)

Zhaopin serves a "Security Verification" interstitial to any non-browser TLS
fingerprint (curl, bun's fetch, arbitrary UAs — all verified blocked
2026-08-31). A real Chromium passes. This is the repo's one deliberate
exception to the zero-dependency portal CLI pattern; see the CLI README.

## Commands

### Search job listings

```bash
bun run .agents/skills/zhaopin-search/cli/src/cli.ts search -q "<关键词>" -l "<城市>" [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — **required.** Keywords (职位名/技能).
- `--location <city>` / `-l <city>` — city name; default `北京`. Only cities
  with verified ID codes are accepted (北京 上海 广州 深圳 天津 杭州 武汉
  西安 成都 南京 苏州 全国) — an unknown city errors instead of guessing.
- `--page <n>` — 1-indexed page (~20 results/page).
- `--limit <n>` / `-n <n>` — client-side cap.
- `--format json|table|plain` — default `json`.
- `--jobage` is **not supported**: zhaopin does not expose posting dates, so
  the flag is rejected rather than silently ignored.

### Fetch full job detail

```bash
bun run .agents/skills/zhaopin-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the jobdetail code from search results (e.g. `CC383625320J40882381309`).
Returns title, company, location, salary, and the full description.

### One-off login (optional)

```bash
bun run .agents/skills/zhaopin-search/cli/src/cli.ts login
```

Opens a **headed** browser; complete the login yourself (QR scan, or 手机号 +
短信验证码 — the code lands on your phone, the CLI never touches it). The
session is saved to `.auth/state.json` (gitignored). With a saved session,
`detail` also returns the salary (hidden behind login otherwise).

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

Search JSON is `{ "meta": { "count", "page" }, "results": [...] }`; each result
carries `id`, `title`, `company`, `location`, `salary`, `date` (always `null`
— zhaopin shows no posting dates), `url`. `date` being null is a data-source
fact, not an error; recency filtering must happen upstream or manually.

## Usage examples

```bash
# 北京的 Java 架构师岗位，表格视图
bun run .agents/skills/zhaopin-search/cli/src/cli.ts search -q "Java 架构师" -l 北京 --format table

# AI 应用方向，只要 10 条
bun run .agents/skills/zhaopin-search/cli/src/cli.ts search -q "AI 应用工程师" -l 北京 -n 10

# 某个目标公司的岗位（关键词直接带公司名）
bun run .agents/skills/zhaopin-search/cli/src/cli.ts search -q "美团 Java" -l 北京

# 看一条职位的完整描述
bun run .agents/skills/zhaopin-search/cli/src/cli.ts detail CC383625320J40882381309 --format plain
```

## Notes

- **No posting dates.** Zhaopin's list and detail pages show recruiter
  activity ("17分钟前回复"), not publish time. `date` is always null.
- **Search is stable, detail is best-effort.** Tencent Cloud EdgeOne
  probabilistically challenges the detail pages ("Security Verification");
  after reloads + one relaunch the CLI gives up with a `BOT_WALL` error
  instead of pretending. Search results already carry salary/location/exp —
  run `detail` again later or `login` first (a logged-in session carries the
  clearance cookies). See url-reference.md.
- **Salaries partially hidden.** Listed salaries show on search cards; detail
  pages hide exact salary behind login. `login` fixes this.
- **ASCII keywords.** Percent-encoded Chinese keywords work on the direct
  path URL first-try; pure-ASCII keywords (e.g. "Java") hit zhaopin's empty
  marker, and the CLI falls back to one token-resolution redirect.
- **City IDs.** Path URLs encode city as `/sou/jl<id>/`; only 北京 (530) is
  verified live — others come from zhaopin's public filter links. Unknown
  cities are rejected rather than guessed (see `helpers.ts` CITY_CODES).
- **Markup changes.** Parsing anchors and quirks are documented in
  `url-reference.md` — update it when zhaopin changes its markup. `dump-card.ts`
  at the CLI root re-dumps the live DOM structure for recalibration.
- **Terminal title.** The CLI sets a neutral window title (`build-tools`) so
  workplace-visible terminals never flash the portal name.
