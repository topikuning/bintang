import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  const name = process.env.APP_NAME || "Bintang";
  return {
    name,
    short_name: name,
    description: "Pengajuan pembayaran & buku kas multi-proyek",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f7fb",
    theme_color: "#4338ca",
    lang: "id",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
