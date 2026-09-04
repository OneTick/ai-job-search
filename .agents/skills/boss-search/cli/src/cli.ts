#!/usr/bin/env bun
// boss-cli — search Boss直聘 (zhipin.com) by attaching to a real, logged-in
// Chrome over CDP (community-validated approach to Boss's anti-bot stack).
//
// Personal use only. Boss's terms prohibit bulk/automated collection: keep
// volume low, one page per search call, human-paced. Risk-control hits stop
// the run and require human verification — never auto-retried.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { runSetup } from "./commands/setup.js"
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

const HELP = `boss-cli — 搜索 Boss直聘 (zhipin.com) 职位

USAGE
  bun run src/cli.ts setup                        # 首次：启动隔离真实 Chrome + 登录（一次）
  bun run src/cli.ts search -q "<关键词>" -l "<城市>" [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>    关键词（职位名/技能）。必填。
  --location, -l <city> 城市名：${CITY_LIST}（或 9 位数字城市码）。默认 北京。
  --page <n>            页码（1 起，30 条/页）。默认 1。
  --limit, -n <n>       客户端截断条数。
  --format <fmt>        json（默认）| table | plain。

EXAMPLES
  bun run src/cli.ts setup
  bun run src/cli.ts search -q "Java 架构师" -l 北京 --format table
  bun run src/cli.ts detail <encryptJobId> --format plain

IMPORTANT
  - setup 只需一次：真实 Chrome 的隔离 profile 会保存登录态。
  - 每次搜索开一个真实页面并被动监听响应；翻页间隔请保持 12s 以上。
  - 命中风控（code 31/37）会直接报 RISK_CONTROL 退出——去 Chrome 窗口完成
    人机验证，等几分钟再低频重试。绝不要自动重试。
  - Personal use only — Boss 的用户协议禁止批量抓取。
`

const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set(["query", "location", "page", "limit", "format", "help", "h"]),
  detail: new Set(["format", "help", "h"]),
  setup: new Set(["help", "h"]),
}

async function main(): Promise<number> {
  setNeutralTitle()
  const flags = parseFlags(process.argv.slice(2))
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
          error: `unknown flag --${key} for '${cmd}' - flags are never silently ignored; see --help`,
          code: "UNKNOWN_FLAG",
        }) + "\n",
      )
      return 1
    }
  }

  if (cmd === "setup") return runSetup()

  if (cmd === "search") {
    const query = typeof flags.query === "string" ? flags.query : undefined
    if (!query) {
      process.stderr.write(JSON.stringify({ error: 'the --query/-q flag is required (e.g. -q "Java 架构师")', code: "NO_QUERY" }) + "\n")
      return 1
    }
    const city = typeof flags.location === "string" && flags.location ? flags.location : "北京"
    if (!(city in CITY_CODES) && !/^\d{9}$/.test(city)) {
      process.stderr.write(
        JSON.stringify({ error: `unsupported city "${city}"; supported: ${CITY_LIST}, or a raw 9-digit city code`, code: "BAD_CITY" }) + "\n",
      )
      return 1
    }
    const page = flags.page ? parseInt(flags.page as string, 10) : 1
    if (isNaN(page) || page < 1) {
      process.stderr.write(JSON.stringify({ error: `--page must be a positive number, got "${flags.page}"`, code: "BAD_ARG" }) + "\n")
      return 1
    }
    const limit = flags.limit ? parseInt(flags.limit as string, 10) : undefined
    const fmt = (flags.format as string) || "json"
    if (!["json", "table", "plain"].includes(fmt)) {
      process.stderr.write(JSON.stringify({ error: `--format must be json | table | plain, got "${fmt}"`, code: "BAD_ARG" }) + "\n")
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

  process.stderr.write(JSON.stringify({ error: `Unknown command "${cmd}"`, code: "BAD_CMD" }) + "\n")
  return 1
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    process.stderr.write(JSON.stringify({ error: e instanceof Error ? e.message : String(e), code: "INTERNAL_ERROR" }) + "\n")
    process.exit(1)
  })
