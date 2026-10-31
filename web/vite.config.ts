import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    target: "es2022",
    cssCodeSplit: false,
    reportCompressedSize: false,
    chunkSizeWarningLimit: 900,
  },
  server: {
    port: 5174,
  },
});
