import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Saudi Job Alert",
  description:
    "Technology roles across Saudi Arabia, pulled straight from employer applicant-tracking systems before they reach the public boards.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Job Alert",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/icon.svg",
    apple: "/apple-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // One value: the app is dark by design, not by system preference.
  themeColor: "#171614",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
          }}
        >
          Skip to results
        </a>

        <header
          className="sticky top-0 z-30 backdrop-blur-md"
          style={{
            background: "color-mix(in srgb, var(--bg) 85%, transparent)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <Link href="/" className="flex items-center gap-2.5 no-underline">
              <span
                className="grid h-9 w-9 shrink-0 place-items-center text-[15px] font-bold"
                style={{
                  background: "var(--accent)",
                  color: "var(--accent-on)",
                  borderRadius: "var(--radius)",
                  letterSpacing: "-0.02em",
                }}
                aria-hidden="true"
              >
                SJ
              </span>
              <span className="leading-tight">
                <span className="block text-[15px] font-bold" style={{ color: "var(--ink)" }}>
                  Saudi Job Alert
                </span>
                <span className="block text-[11px]" style={{ color: "var(--ink-3)" }}>
                  Riyadh tech roles, first
                </span>
              </span>
            </Link>

            <nav className="flex items-center gap-1 text-[13px] font-medium">
              <Link
                href="/"
                className="px-3 py-1.5 no-underline transition-colors hover:bg-[var(--surface-2)]"
                style={{ color: "var(--ink-2)", borderRadius: "var(--radius-sm)" }}
              >
                Jobs
              </Link>
              <Link
                href="/sources"
                className="px-3 py-1.5 no-underline transition-colors hover:bg-[var(--surface-2)]"
                style={{ color: "var(--ink-2)", borderRadius: "var(--radius-sm)" }}
              >
                Sources
              </Link>
            </nav>
          </div>
        </header>

        <main id="main" className="mx-auto max-w-6xl px-4 pb-20 pt-5 sm:px-6">
          {children}
        </main>

        <footer
          className="mx-auto max-w-6xl px-4 pb-10 text-[12px] sm:px-6"
          style={{ color: "var(--ink-3)" }}
        >
          Postings are collected from employer career systems and public job APIs. Roles missing a
          stated location, track or experience level are kept and shown under Unclassified rather
          than discarded.
        </footer>
      </body>
    </html>
  );
}
