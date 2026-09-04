# boss-cli

Search Boss直聘 (zhipin.com) by attaching to a real, logged-in Chrome over
CDP. Personal use only — see SKILL.md's warning; Boss's anti-bot stack is the
strictest of the Chinese boards and the only durable approach is a real
browser with a real login.

## Architecture (why not Playwright-launched browsers)

Playwright-launched browsers (headless shell and full chromium, headed too)
get fingerprinted and wiped to about:blank by Boss's login app, and injected
API calls trip risk code 37. This CLI instead:

1. `setup` launches a **real Chrome** (auto-detected: Windows Chrome via WSL
   interop, or linux google-chrome) with an isolated persistent profile and
   CDP on port 9222. You log in once in the window (QR scan easiest).
2. `search`/`detail` attach over CDP, open a real page, and passively capture
   the `joblist.json` responses the page itself issues — zero injected
   requests, plaintext `salaryDesc` (font-obfuscation bypassed by design).

Reference implementation this mirrors: eatmoreduck/boss-zhipin-scraper (1269★).

## Setup

```bash
cd .agents/skills/boss-search/cli && npm install && cd ../../../..
bun run .agents/skills/boss-search/cli/src/cli.ts setup
```

WSL2: the Windows Chrome's CDP binds on the Windows side — mirrored
networking (Win11 default) reaches it at 127.0.0.1; NAT-mode WSL needs a
portproxy or a linux google-chrome install.

## Operational rules

- One page per search call; ≥12s between calls; a handful of searches per day.
- Risk control (code 31/37) → `RISK_CONTROL` error and STOP. Verify in the
  Chrome window, cool down, lower the rate. Never auto-retry.
- The real Chrome must stay running; closing it means re-running `setup`.
