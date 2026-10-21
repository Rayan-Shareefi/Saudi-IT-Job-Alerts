import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

/**
 * The code this machine is running, as a short commit id - recorded on every
 * run (runs.ts recordVersion) so the website can say whether the laptop is
 * current. "not a git copy" for a folder that was copied, which can never
 * update itself (docs/laptop-setup.md).
 */
export function codeVersion(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  if (!existsSync(".git")) return "not a git copy";
  const r = spawnSync("git", ["rev-parse", "--short=7", "HEAD"], { encoding: "utf8", windowsHide: true });
  return r.stdout?.trim() || "unknown";
}
