import { sourceStats } from "@/lib/sources/registry";

/**
 * Shown instead of the job list when Supabase is unreachable. The two ways this
 * happens - no credentials yet, or credentials set but the migration not run -
 * need different fixes, so the notice names both rather than showing a stack.
 */
export function SetupNotice({ error }: { error?: string }) {
  const stats = sourceStats();
  const missingTable = error?.includes("does not exist") || error?.includes("schema cache");

  const steps: Array<{ title: string; body: React.ReactNode }> = [
    {
      title: "Create a Supabase project",
      body: (
        <>
          Free tier is enough. Copy the project URL, the <code>anon</code> key and the{" "}
          <code>service_role</code> key from <em>Project settings &rarr; API</em>.
        </>
      ),
    },
    {
      title: "Fill in .env.local",
      body: (
        <>
          Copy <code>.env.example</code> to <code>.env.local</code> and paste the three Supabase
          values in.
        </>
      ),
    },
    {
      title: "Create the tables",
      body: (
        <>
          Paste <code>supabase/migrations/0001_init.sql</code> into the Supabase SQL editor and run
          it, or run <code>npm run db:push</code>.
        </>
      ),
    },
    {
      title: "Collect the first batch",
      body: (
        <>
          Run <code>npm run ingest</code>. It walks all {stats.total} sources; add{" "}
          <code>-- --skip-browser</code> for a faster first pass.
        </>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-2xl py-6">
      <div className="surface p-6 sm:p-8" style={{ borderRadius: "var(--radius-lg)" }}>
        <span
          className="inline-block rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide"
          style={{ background: "var(--warn-soft)", color: "var(--warn-ink)" }}
        >
          {missingTable ? "Schema missing" : "Setup needed"}
        </span>

        <h1 className="mt-3 text-xl font-bold sm:text-2xl" style={{ color: "var(--ink)" }}>
          {missingTable ? "Database reached, tables not created yet" : "Connect the database"}
        </h1>

        <p className="mt-2 text-[14px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
          The app is built and the source registry is loaded — {stats.total} sources across{" "}
          {Object.keys(stats.byAdapter).length} adapters, covering {stats.employersProbed} employers.
          It just needs somewhere to store what it collects.
        </p>

        <ol className="mt-5 grid list-none gap-3 p-0">
          {steps.map((step, i) => (
            <li key={step.title} className="flex gap-3">
              <span
                className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] font-bold"
                style={{ background: "var(--accent-soft)", color: "var(--accent-ink)" }}
                aria-hidden="true"
              >
                {i + 1}
              </span>
              <div>
                <p className="text-[14px] font-semibold" style={{ color: "var(--ink)" }}>
                  {step.title}
                </p>
                <p className="mt-0.5 text-[13px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
                  {step.body}
                </p>
              </div>
            </li>
          ))}
        </ol>

        {error && (
          <details className="mt-6">
            <summary className="cursor-pointer text-[12px] font-medium" style={{ color: "var(--ink-3)" }}>
              Error detail
            </summary>
            <pre
              className="mt-2 overflow-x-auto p-3 text-[11px]"
              style={{ background: "var(--surface-2)", color: "var(--ink-2)", borderRadius: "var(--radius-sm)" }}
            >
              {error}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}
