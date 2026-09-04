import { join } from "path";
import { existsSync } from "fs";

const CLI_PATH = join(import.meta.dir, "../src/cli.ts");
// The devDependency "bun" package installs a local binary; the global PATH may
// not have bun at all (this environment's case). Prefer the local one.
const LOCAL_BUN = join(import.meta.dir, "../node_modules/.bin/bun");
const BUN = existsSync(LOCAL_BUN) ? LOCAL_BUN : "bun";

export interface CLIResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function runCLI(args: string[]): Promise<CLIResult> {
  const proc = Bun.spawn([BUN, "run", CLI_PATH, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

export function parseJSON<T = unknown>(result: CLIResult): T {
  if (result.exitCode !== 0) {
    throw new Error(
      `CLI exited with code ${result.exitCode}. stderr: ${result.stderr}`
    );
  }
  try {
    return JSON.parse(result.stdout) as T;
  } catch {
    throw new Error(
      `Failed to parse JSON. stdout: ${result.stdout}\nstderr: ${result.stderr}`
    );
  }
}
