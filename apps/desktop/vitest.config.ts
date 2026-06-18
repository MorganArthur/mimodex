import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

const packageJson = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version?: string };

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version ?? "0.0.0"),
  },
  plugins: [react()],
  test: {
    environment: "jsdom",
  },
});
