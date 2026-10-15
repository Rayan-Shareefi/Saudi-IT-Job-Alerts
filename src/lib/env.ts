/**
 * Environment access that treats a blank value as unset.
 *
 * GitHub Actions turns `${{ secrets.NAME }}` for a secret that was never
 * created into an empty string, not an absent variable. `process.env.X ?? d`
 * only falls back on null/undefined, so the empty string sailed through: the
 * digest sent `from: ""` to Resend and every run since 2026-09-04 failed with
 * "Invalid `from` field" (HANDOVER §5.5 is the same trap with REMOVAL_SECRET).
 *
 * Read optional configuration through these helpers, never with `??`.
 */
export function envStr(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** The first of several variables that carries a real value. */
export function envFirst(...names: string[]): string | undefined {
  for (const n of names) {
    const v = envStr(n);
    if (v !== undefined) return v;
  }
  return undefined;
}

export function envInt(name: string, fallback: number): number {
  const v = envStr(name);
  if (v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function envFlag(name: string): boolean {
  const v = envStr(name)?.toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}
