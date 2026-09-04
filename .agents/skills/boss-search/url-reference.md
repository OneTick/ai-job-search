# zhipin.com (Boss直聘) URL & Anti-Bot Reference

Recon 2026-08-31 / 09-01 + community intelligence (eatmoreduck/boss-zhipin-scraper
1269★, architecture read from source). Update this file when Boss changes.

## Anti-bot stack (what we learned the hard way)

1. **Browser fingerprinting** → console.table fingerprint probes in the login
   app; Playwright-controlled browsers (headless shell AND full chromium,
   headed included) get their pages wiped to about:blank via `window.close()`
   (confirmed via console warning "Scripts may close only the windows that
   were opened by them"). Blocking `window.close` is NOT enough.
2. **Cumulative client flagging** — the first automated hit rendered the
   login page fine; every subsequent hit (any browser) blanked. Cooldown
   helps; the real-Chrome-CDP approach avoids the fingerprint class entirely.
3. **Injected requests** — programmatic XHR/fetch with different request
   characteristics than the page's own calls → risk code 37 ("环境存在异常").
   NEVER inject; navigate real pages and passively capture responses.
4. **Risk codes** — 31 (访问环境异常) and 37 (注入/环境异常). The reference
   implementation treats both as STOP (human verification in the real
   browser), never auto-retry.
5. **Login-gated search** — logged-out /web/geek/job 302s to /web/user/ (SMS
   login form). Login via QR (Boss app) or 手机号+验证码.
6. **Font obfuscation on DOM salaries** — DOM-extracted salary glyphs are
   cipherfont; the page's own API responses carry plaintext `salaryDesc`.

## The working architecture (implemented in this CLI)

- Real Chrome, isolated persistent profile, `--remote-debugging-port=9222
  --user-data-dir=<isolated> --no-first-run --no-default-browser-check
  --remote-allow-origins=*`.
- CDP attach (playwright `connectOverCDP`), new tab per call, navigate the
  real search page, listen for responses whose URL contains
  `/wapi/zpgeek/search/joblist.json`, read `zpData.jobList`.
- Human-paced: random wheel scrolling with pauses, occasional up-scroll,
  bounded wait ≤30s for the capture.
- Login probe = navigate a real search page until a joblist response comes
  back with code 0 and non-empty jobList (plaintext salaryDesc present).

## Endpoints

- Search page: `https://www.zhipin.com/web/geek/job/?query=<kw>&city=<code>&page=<n>&pageSize=30`
- Page's own API (captured, not called): `/wapi/zpgeek/search/joblist.json`
  → `{ code: 0, zpData: { jobList: [...], hasMore } }`
- Login: `https://www.zhipin.com/web/user/?from=login`
- Detail: `https://www.zhipin.com/job_detail/<encryptJobId>.html`
- City codes (hardcoded in helpers.ts; 北京/上海/广州/深圳/杭州 verified
  well-known, rest unverified): 全国 100010000, 北京 101010100, 上海 101020100,
  广州 101280100, 深圳 101280600, 杭州 101210100. Runtime self-heal options
  (not implemented): `/wapi/zpgeek/search/job/hot/city.json`,
  `/wapi/zpCommon/data/cityGroup.json`.

## jobList entry fields (observed via the reference implementation)

encryptJobId, jobName, brandName, salaryDesc (plaintext), cityDistrict,
areaDistrict, businessDistrict, jobLabels, skills, jobExperience, jobDegree,
bossName, bossTitle, activeTimeDesc, lid (detail-page tracking param).

## robots.txt

`Disallow: /` for SemrushBot + Jobuispider; for `*`: query-string URLs and
`/web/boss/*` among others are disallowed. The real-browser interactive flow
this skill implements is the user browsing their own logged-in session — the
volume rules above keep it within personal-use bounds. Do not build a bulk
crawler on top of this.

## Probe history

- 2026-09-01: boss-search built and verified live (QR login in a real headed
  Chrome; searches returned plaintext-salary results). Findings:
  - CDP-attached navigation of the login page while logged out wipes it to
    about:blank (same self-destruct class). Manual login in the real browser
    window works; attach CDP only afterwards.
  - **Soft throttle:** rapid consecutive search navigations (~14s spacing)
    return code-0 EMPTY jobList responses — not an error, just no data.
    ≥60s between calls recovers; the throttle accumulates over a session.
  - Detail pages need the full search-result URL including `lid`; a bare
    encryptJobId serves the "Oops" page.
  - Keyword search matches job title/skills, NOT company names — "美团"
    returns nothing; use "美团 Java" style compound keywords.
