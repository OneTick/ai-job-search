# zhaopin.com URL & Markup Reference

Everything learned by probing the live site on 2026-08-31. This is the file to
update when zhaopin changes its markup and the CLI starts returning empty or
garbled results.

## Access characteristics

- **Bot detection:** "Security Verification" interstitial for any non-browser
  TLS fingerprint. Verified blocked: plain `curl` (any UA, incl. full browser
  headers), `bun fetch`. Verified working: Playwright Chromium (headless OK).
  The wall is TLS/network-level, not UA-level — header spoofing does not help.
- **Search is public SSR.** Result lists render server-side, no login needed.
  Interactive features (立即沟通/投递, exact salary) need login.
- **robots.txt** (www.zhaopin.com): `Disallow: /*?*` (all query-string URLs),
  `Disallow: /sem/*`, `Disallow: /web/boss/*`, various `/wapi/` rules, and
  `Disallow: /job_detail/l*.html` + `/job_pk/*` (old-style detail paths — NOT
  the current `/jobdetail/<ID>.htm` pattern, which is allowed).
  → The CLI's path-style search URLs and jobdetail pages are robots-clean; the
  `sou.zhaopin.com/?kw=...` entry point used as a token-resolution fallback is
  technically covered by `/*?*` (one redirect per failed ASCII search).

## Search URL pattern

```
https://www.zhaopin.com/sou/jl{cityId}/kw{keyword}{/p{page}}
```

- `cityId`: 北京 `530` (verified live). Others in `helpers.ts` CITY_CODES come
  from zhaopin's public filter links, unverified: 上海 538, 广州 635, 深圳 765,
  天津 531, 杭州 653, 武汉 736, 西安 854, 成都 801, 南京 632, 苏州 636. Empty
  (`全国`) → no `jl` segment.
- `keyword`: percent-encoded UTF-8. **Verified live:** Chinese keywords work
  directly (`kw%E6%9E%B6%E6%9E%84%E5%B8%88` = 架构师). Pure-ASCII keywords fail
  with the empty marker (`kwJava` → "很抱歉，您搜索的职位找不到"), because
  zhaopin's canonical form is an internal token (`kw01500O80EO062` for "Java",
  `kwCUR6F12U10` for 架构师). Token encoding is opaque; the CLI resolves it by
  following the 301 from `https://sou.zhaopin.com/?kw=<enc>&jl=<cityId>`.
- Pagination: append `/p2`, `/p3`... (verified live on p2).
- Sort variants exist on the page (智能匹配 / 薪酬最高 / 最新发布) but their URL
  forms were not probed — future work.

## Search result page structure (SSR)

- Each posting card contains an anchor to `/jobdetail/<ID>.htm`
  (`ID` = e.g. `CC383625320J40882381309` — `CC` or `CCL` prefix + digits + `J` + digits).
- Card visible fields: 职位标题 (anchor text), 薪资 (e.g. `1.2-1.7万`,
  `2-4万·15薪`, `面议`), 地点 (`北京·朝阳·望京`), 经验/学历 (`3-5年/本科`),
  技能标签 (MySQL, Spring...), 公司名 + `companydetail/CZ*.htm` link,
  公司属性 (性质/规模/行业), 招聘者姓名/头衔, 回复时效 (`17分钟前回复`),
  外派标记 (`tag_JD_waipai.png`).
- **No posting date anywhere** on list or detail pages.
- Empty state: image alt "很抱歉，您搜索的职位找不到" + "登录之后再搜索，海量职位等你挑".
- Parser (helpers.ts `extractCards`): walks all `/jobdetail/` anchors, lifts
  each to its card container via CARD_SELECTORS, parses company/salary/location
  heuristically from the card text. When results look wrong, dump a live page
  (`curl` will not work — use a Playwright `page.content()`) and re-anchor.

## Detail page pattern

```
https://www.zhaopin.com/jobdetail/<ID>.htm
```

- Server-rendered, no login needed for the description.
- Salary shows as `**-*元` when logged out (hidden behind "查看薪资" → login).
- Fields: title, company block (name + 已上市/规模/行业), 地点 (partially
  masked as `北京********`), 经验/学历 tags, full 职位描述, 发布者
  (name + 头衔 + 在线状态). No publish date.
- detail parser: `h1` (fallback page `<title>` before `【`), `[class*='salary']`,
  `[class*='company'] a`, description = deepest text container >200 chars.

## Probe history

- 2026-08-31: initial reconnaissance (this document). Verified search path,
  pagination, ASCII-token fallback, detail SSR, curl blocked by bot wall.
- 2026-09-01: live calibration + test suite green (6/6). Findings:
  - Search page: stable across headless shell and full chromium. Card anchors
    verified in DOM: `.joblist-box__item` root, `a.jobinfo__name`,
    `.jobinfo__salary`, `.jobinfo__other-info-item` ×3 (地点/经验/学历),
    `.companyinfo__name`. Fallback anchor-walk parser kept for markup drift.
  - Detail pages: EdgeOne challenges are persistent for unauthenticated
    headless clients (warm-up via the search page does NOT help; one early
    full-chromium pass was luck). CLI retries (3 in-page reloads + 1 relaunch)
    then exits `BOT_WALL`. Untested lever: a logged-in storageState from `login`
    (clearance cookies) — try this first when revisiting.
  - The one EdgeOne pass came from the full chromium binary
    (`~/.cache/ms-playwright/chromium-1237`), not the headless shell —
    `launchBrowser` prefers full chromium for this reason (headless shell also
    fails Boss直聘's checks, which blank the page via `window.close()`).
  - Boss直聘 (sibling recon, see boss-search when it exists): logged-out search
    302s to the login page; the login/home pages self-destruct to about:blank
    under automation (`window.close()` after console.table fingerprinting),
    and flag the client cumulatively after repeated hits — cool down before
    retrying, enter via natural flows, and prefer a headed browser (WSLg works).
