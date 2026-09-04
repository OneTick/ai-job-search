#!/usr/bin/env bun
// zhaopin-cli — search 智联招聘 (zhaopin.com) job listings via a real browser.
//
// Zhaopin blocks non-browser HTTP clients (TLS-fingerprint bot detection), so
// this CLI drives Playwright/Chromium instead of plain fetch — the repo's one
// deliberate exception to the zero-dependency portal CLI pattern.
//
// Personal use only: keep volume low, no commercial or bulk data collection.
// robots.txt disallows query-string URLs; the CLI uses path-style search URLs
// and touches the query-string entry point only as a one-redirect fallback for
// ASCII keywords (see SKILL.md Notes).

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { runLogin } from "./commands/login.js"
import { CITY_CODES, setNeutralTitle } from "./helpers.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { q: "query", l: "location", n: "limit" }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith("--") || (a.startsWith("-") && a.length > 1)) {
      const key = alias[a.replace(/^-+/, "")] ?? a.replace(/^-+/, "")
      const next = argv[i + 1]
      if (next === undefined || next.startsWith("-")) {
        flags[key] = true
      } else {
        flags[key] = next
        i++
      }
    } else {
      ;(flags._ as string[]).push(a)
    }
  }
  return flags
}

const CITY_LIST = Object.keys(CITY_CODES).join(" / ")

const HELP = `zhaopin-cli — 搜索智联招聘 (zhaopin.com) 职位

USAGE
  bun run src/cli.ts search -q "<关键词>" -l "<城市>" [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain]
  bun run src/cli.ts login                       # 一次性登录，保存会话

SEARCH FLAGS
  --query, -q <text>    关键词（职位名/技能）。必填。
  --location, -l <city> 城市名：${CITY_LIST}。默认 北京。
  --page <n>            页码（1 起，约 20 条/页）。默认 1。
  --limit, -n <n>       客户端截断条数。
  --format <fmt>        json（默认）| table | plain。
  --jobage              不支持：智联不公开职位发布时间，传了会报错。

EXAMPLES
  bun run src/cli.ts search -q "Java 架构师" -l 北京 --format table
  bun run src/cli.ts search -q "AI 应用工程师" -l 北京 -n 10
  bun run src/cli.ts detail CC383625320J40882381309 --format plain

NOTES
  - 登录（可选）：bun run src/cli.ts login，之后薪资等登录后字段可见。
  - Personal use only — keep volume low; zhaopin's terms prohibit bulk scraping.
`

const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set(["query", "location", "page", "limit", "format", "help", "h"]),
  detail: new Set(["format", "help", "h"]),
  login: new Set(["help", "h"]),
}

async function main(): Promise<number> {
  setNeutralTitle()
  const argv = process.argv.slice(2)
  const flags = parseFlags(argv)
  const cmd = (flags._ as string[])[0]

  if (!cmd || flags.help || flags.h) {
    process.stdout.write(HELP)
    return cmd ? 0 : 1
  }

  const knownFlags = KNOWN_FLAGS[cmd]
  if (knownFlags) {
    for (const key of Object.keys(flags)) {
      if (key === "_" || knownFlags.has(key)) continue
      process.stderr.write(
        JSON.stringify({
          error: `unknown flag --${key} for '${cmd}' - flags are never silently ignored, because a discarded filter changes what the search returns; see --help for the supported flags`,
          code: "UNKNOWN_FLAG",
        }) + "\n",
      )
      return 1
    }
  }

  if (cmd === "search") {
    const query = typeof flags.query === "string" ? flags.query : undefined
    if (!query) {
      process.stderr.write(JSON.stringify({ error: 'the --query/-q flag is required (e.g. -q "Java 架构师")', code: "NO_QUERY" }) + "\n")
      return 1
    }
    const city = typeof flags.location === "string" && flags.location ? flags.location : "北京"
    if (!(city in CITY_CODES)) {
      process.stderr.write(
        JSON.stringify({
          error: `unsupported city "${city}" - zhaopin encodes cities as IDs and only verified cities are supported to avoid silently searching the wrong one; supported: ${CITY_LIST}`,
          code: "BAD_CITY",
        }) + "\n",
      )
      return 1
    }
    const fmt = (flags.format as string) || "json"
    if (!["json", "table", "plain"].includes(fmt)) {
      process.stderr.write(JSON.stringify({ error: `--format must be json | table | plain, got "${fmt}"`, code: "BAD_ARG" }) + "\n")
      return 1
    }
    const page = flags.page ? parseInt(flags.page as string, 10) : 1
    if (isNaN(page) || page < 1) {
      process.stderr.write(JSON.stringify({ error: `--page must be a positive number, got "${flags.page}"`, code: "BAD_ARG" }) + "\n")
      return 1
    }
    const limit = flags.limit ? parseInt(flags.limit as string, 10) : undefined
    if (flags.limit !== undefined && (isNaN(limit!) || limit! < 1)) {
      process.stderr.write(JSON.stringify({ error: `--limit must be a positive number, got "${flags.limit}"`, code: "BAD_ARG" }) + "\n")
      return 1
    }
    const opts: SearchOpts = { query, city, page, limit, format: fmt as SearchOpts["format"] }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    const id = (flags._ as string[])[1]
    if (!id) {
      process.stderr.write(JSON.stringify({ error: "detail requires an <id|url>", code: "NO_ID" }) + "\n")
      return 1
    }
    const fmt = (flags.format as string) || "json"
    if (!["json", "plain"].includes(fmt)) {
      process.stderr.write(JSON.stringify({ error: `--format must be json | plain, got "${fmt}"`, code: "BAD_ARG" }) + "\n")
      return 1
    }
    const opts: DetailOpts = { id, format: fmt as DetailOpts["format"] }
    return runDetail(opts)
  }

  if (cmd === "login") {
    return runLogin()
  }

  process.stderr.write(JSON.stringify({ error: `Unknown command "${cmd}"`, code: "BAD_CMD" }) + "\n")
  return 1
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    process.stderr.write(
      JSON.stringify({
        error: e instanceof Error ? e.message : String(e),
        code: "INTERNAL_ERROR",
      }) + "\n",
    )
    process.exit(1)
  })
