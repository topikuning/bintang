import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

const APP = process.env.APP_NAME || "Bintang";
const PENANDA = process.env.PENANDA_LINGKUNGAN?.trim();

export const metadata: Metadata = {
  title: { default: PENANDA ? `[${PENANDA}] ${APP}` : APP, template: `${PENANDA ? `[${PENANDA}] ` : ""}%s · ${APP}` },
  description: "Pengajuan pembayaran & buku kas multi-proyek.",
  applicationName: APP,
  appleWebApp: { capable: true, title: APP, statusBarStyle: "default" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#4338ca",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
