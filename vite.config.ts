/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", chunkSizeWarningLimit: 1500 },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
