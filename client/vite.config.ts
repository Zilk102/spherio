import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@spherio/shared": path.resolve(__dirname, "../shared/src/index.ts"),
    },
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/colyseus": {
        target: process.env.VITE_PROXY_TARGET ?? "http://server:2567",
        ws: true,
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: true,
    port: 4173,
  },
});
