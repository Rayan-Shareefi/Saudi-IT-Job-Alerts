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
    ];
  },
};

export default nextConfig;
