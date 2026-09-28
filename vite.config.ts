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
    // Many tests run fake agent processes. Run their process trees serially so
    // they cannot starve one another on a busy machine or CI runner.
    maxWorkers: 1,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
