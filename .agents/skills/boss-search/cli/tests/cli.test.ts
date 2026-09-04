// Flag-validation contract tests (offline). The live flow (setup/search/detail)
// requires a real Chrome with a logged-in profile and human verification on
// first use — covered by manual bring-up, not by CI. Keep CI honest but quiet.

import { describe, expect, test } from "bun:test";
import { parseJSON, runCLI } from "./helpers";

describe("boss-cli (offline contract)", () => {
  test("bogus flag exits 1 with a JSON error on stderr", async () => {
    const result = await runCLI(["search", "-q", "Java", "--bogus", "1"]);
    expect(result.exitCode).toBe(1);
    const err = JSON.parse(result.stderr) as { error: string; code: string };
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

  test("search without a running CDP Chrome exits 1 with NO_CDP (not a crash)", async () => {
    const result = await runCLI(["search", "-q", "Java 架构师", "-l", "北京", "-n", "1"]);
    expect(result.exitCode).toBe(1);
    const err = JSON.parse(result.stderr) as { code: string };
    expect(["NO_CDP", "RISK_CONTROL", "NOT_LOGGED_IN"]).toContain(err.code);
  });
});
