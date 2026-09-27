import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  base: "./",
  plugins: [viteSingleFile()],
  build: {
    target: "es2022",
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 2_500,
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
    // Many tests run fake agent processes, which start slowly on a busy machine or a CI runner.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
