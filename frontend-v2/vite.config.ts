import path from "node:path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5174,
    proxy: {
      "/api": {
        target: process.env.VITE_BACKEND_URL || "http://localhost:8000",
        changeOrigin: true,
      },
      "/files": {
        target: process.env.VITE_BACKEND_URL || "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 600,
    // Eksplisit disable sourcemap di prod build supaya source code tidak
    // ter-expose ke client (devtools). Default Vite memang false, tapi
    // dieksplisitkan supaya commit history mencatat intent.
    sourcemap: false,
    rollupOptions: {
      output: {
        // Manual chunks: pisahkan vendor besar supaya tidak satu blob
        // monolitik. Strategi:
        //  - 'recharts' chunk terpisah (~115KB gzip) -- lazy load saat
        //    user buka Dashboard/Reports (chart-heavy).
        //  - 'tanstack' chunk -- query + table.
        //  - 'radix' chunk -- semua @radix-ui primitives.
        //  - 'react-vendor' utk react+dom+router (selalu di-load).
        // Sisanya (lucide, axios, RHF, zustand, sonner, dll) ikut
        // chunk default berdasar import graph -- tidak terlalu besar.
        manualChunks: {
          recharts: ["recharts"],
          tanstack: [
            "@tanstack/react-query",
            "@tanstack/react-table",
          ],
          radix: [
            "@radix-ui/react-dialog",
            "@radix-ui/react-dropdown-menu",
            "@radix-ui/react-label",
            "@radix-ui/react-popover",
            "@radix-ui/react-separator",
            "@radix-ui/react-slot",
            "@radix-ui/react-tooltip",
          ],
          "react-vendor": ["react", "react-dom", "react-router-dom"],
        },
      },
    },
  },
})
