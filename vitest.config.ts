import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    pool: "threads",
    maxWorkers: 1,
    fileParallelism: false,
    testTimeout: 15_000,
    coverage: { reporter: ["text", "json", "html"] },
  },
  resolve: { alias: { "@": path.resolve(currentDirectory, "./src"), "server-only": path.resolve(currentDirectory, "./src/test/server-only.ts") } },
});
