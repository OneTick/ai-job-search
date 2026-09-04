# zhaopin-cli

Search 智联招聘 (zhaopin.com) from the command line. Personal use only.

## Why Playwright (the one dependency)

Zhaopin serves a "Security Verification" bot wall to any non-browser TLS
fingerprint — verified that plain `curl` fails with any User-Agent and with
full browser sec-ch-ua headers (2026-08-31). Only a real Chromium passes, so
this CLI's sole runtime dependency is `playwright` (pinned 1.60.0 to match the
shared browser cache at `~/.cache/ms-playwright/chromium-1237`). This is the
repo's one deliberate exception to the zero-dependency portal CLI pattern.

## Setup

```bash
cd .agents/skills/zhaopin-search/cli && bun install && cd ../../../..
# 浏览器二进制通常已存在（~/.cache/ms-playwright）；缺失时：
cd .agents/skills/zhaopin-search/cli && npx playwright install chromium && cd ../../../..
```

Optional login (see salaries on detail pages):

```bash
bun run .agents/skills/zhaopin-search/cli/src/cli.ts login
```

The session is saved to `.auth/state.json` (gitignored). Login happens in a
headed browser window you control (WSL2: needs WSLg); the CLI never sees your
phone number or SMS code.

## Usage

```bash
bun run .agents/skills/zhaopin-search/cli/src/cli.ts search -q "Java 架构师" -l 北京 --format table
bun run .agents/skills/zhaopin-search/cli/src/cli.ts detail <id> --format plain
```

See SKILL.md for the full flag reference and `url-reference.md` for the
endpoints/markup anchors to update when zhaopin changes its site.
