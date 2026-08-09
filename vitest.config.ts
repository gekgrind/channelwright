import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: { environment: "node", coverage: { reporter: ["text", "json", "html"] } },
  resolve: { alias: { "@": path.resolve(currentDirectory, "./src") } },
});
