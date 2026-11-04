import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  // Jangan tulis AGENTS.md otomatis tiap `next dev`.
  agentRules: false,
  compress: true,
  experimental: {
    serverActions: {
      // Lampiran (nota, bukti transfer) dikirim lewat server action.
      // Batas per berkas 10 MB, beberapa berkas sekaligus + overhead multipart.
      bodySizeLimit: "25mb",
    },
    // proxy (dulu middleware) membungkus semua rute; tanpa ini unggahan >1 MB ditolak
    // framework sebelum server action sempat berjalan.
    proxyClientMaxBodySize: "25mb",
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
