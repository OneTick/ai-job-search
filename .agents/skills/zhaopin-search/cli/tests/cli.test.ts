// Live smoke tests against zhaopin.com — same convention as the other portal
// CLIs: a real search, one detail fetch, and the flag-validation contract.
// Personal-use volume: 3 browser sessions per full run. Keep it that way.

import { describe, expect, test } from "bun:test";
import { parseJSON, runCLI, type CLIResult } from "./helpers";

interface SearchJSON {
  meta: { count: number; page: number };
  results: Array<{ id: string | null; title: string | null; url: string | null }>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Each live CLI call launches a full Chromium; rapid back-to-back launches
// crash the browser ("Target page, context or browser has been closed").
// Space them out and retry transient browser deaths once before failing.
async function runLive(args: string[]): Promise<CLIResult> {
  await sleep(3000);
  let result = await runCLI(args);
  if (result.exitCode !== 0 && result.stderr.includes("browser has been closed")) {
    await sleep(5000);
    result = await runCLI(args);
  }
  return result;
}

describe("zhaopin-cli", () => {
  test("search returns real results for a Chinese keyword (live)", async () => {
    const result = await runLive(["search", "-q", "架构师", "-l", "北京", "-n", "5"]);
    expect(result.exitCode).toBe(0);
    const json = parseJSON<SearchJSON>(result);
    expect(json.results.length).toBeGreaterThan(0);
    for (const r of json.results) {
      expect(r.id).not.toBeNull();
      expect(r.title).not.toBeNull();
      expect(r.url).toContain("zhaopin.com/jobdetail/");
    }
  });

  test("detail extracts a readable description (live)", async () => {
    const search = await runLive(["search", "-q", "架构师", "-l", "北京", "-n", "1"]);
    const json = parseJSON<SearchJSON>(search);
    const id = json.results[0]?.id;
    expect(id).toBeTruthy();
    const result = await runLive(["detail", id!, "--format", "json"]);
    if (result.exitCode !== 0) {
      // EdgeOne challenges detail pages probabilistically (search is stable,
      // detail is not — see url-reference.md). A confirmed bot wall is an
      // environmental skip, not a parser regression; anything else fails.
      const err = JSON.parse(result.stderr) as { code?: string };
      if (err.code === "BOT_WALL") {
        console.warn("detail skipped: EdgeOne bot wall (known limitation, see url-reference.md)");
        return;
      }
      throw new Error(`detail failed unexpectedly: ${result.stderr}`);
    }
    const detail = parseJSON<{ id: string | null; title: string | null; description?: string | null }>(result);
    expect(detail.id).toBe(id);
    expect(detail.title).not.toBeNull();
    if (detail.description) expect(detail.description.length).toBeGreaterThan(50);
  });

  test("bogus flag exits 1 with a JSON error on stderr", async () => {
    const result = await runCLI(["search", "-q", "Java", "--bogus", "1"]);
    expect(result.exitCode).toBe(1);
    const err = JSON.parse(result.stderr) as { error: string; code: string };
    expect(err.code).toBe("UNKNOWN_FLAG");
  });

  test("unsupported --jobage is rejected, not silently ignored", async () => {
    const result = await runCLI(["search", "-q", "Java", "--jobage", "14"]);
    expect(result.exitCode).toBe(1);
    const err = JSON.parse(result.stderr) as { code: string };
    expect(err.code).toBe("UNKNOWN_FLAG");
  });

  test("missing required query exits 1 with NO_QUERY", async () => {
    const result = await runCLI(["search", "-l", "北京"]);
    expect(result.exitCode).toBe(1);
    const err = JSON.parse(result.stderr) as { code: string };
    expect(err.code).toBe("NO_QUERY");
  });

  test("unverified city is rejected with BAD_CITY", async () => {
    const result = await runCLI(["search", "-q", "Java", "-l", "乌鲁木齐"]);
    expect(result.exitCode).toBe(1);
    const err = JSON.parse(result.stderr) as { code: string };
    expect(err.code).toBe("BAD_CITY");
  });
});
