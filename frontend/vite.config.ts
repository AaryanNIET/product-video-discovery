import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Same-origin API in development: the browser calls /api and Vite forwards it.
    proxy: { "/api": { target: process.env.VITE_PROXY_TARGET || "http://localhost:4000", changeOrigin: true } },
  },
});
