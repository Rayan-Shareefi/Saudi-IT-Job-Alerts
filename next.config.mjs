/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // tesseract.js (OCR, laptop only) ships worker scripts and WebAssembly that
  // webpack cannot bundle - the build crashed in its hashing (2026-10-20).
  serverExternalPackages: ["cheerio", "tesseract.js"],
  async headers() {
    return [
      {
        source: "/manifest.webmanifest",
        headers: [{ key: "Content-Type", value: "application/manifest+json" }],
      },
      {
        // Security review, 2026-10-22. The write key sits in the browser's
        // storage, so no other site may frame the board and trick a click on
        // Hide or "Stop reading it" (clickjacking); and a page never leaks its
        // address, or the browser guesses a file's type, on the way out.
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
