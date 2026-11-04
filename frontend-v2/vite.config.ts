import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
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
        manualChunks(id) {
          if (id.includes("/recharts/") || id.includes("/recharts@")) return "recharts"
          if (id.includes("/@tanstack/") || id.includes("/@tanstack+")) return "tanstack"
          if (id.includes("/@radix-ui/") || id.includes("/@radix-ui+")) return "radix"
          if (/[\\/]node_modules[\\/](react|react-dom|react-router)([\\/]|@)/.test(id)) {
            return "react-vendor"
          }
          return undefined
        },
      },
    },
  },
})
