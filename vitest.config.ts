import { defineConfig } from "vitest/config";
// Suites reuse one fake token for different identities, so the per-request
// cache is off by default; tests/request-cache.test.ts turns it on.
export default defineConfig({
  test: { include: ["tests/**/*.test.ts"], env: { API_CACHE_MS: "0" } },
});
