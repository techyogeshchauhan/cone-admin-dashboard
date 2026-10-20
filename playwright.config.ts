import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./browser-tests",
  fullyParallel: false,
  use: {
    baseURL: "http://127.0.0.1:3010",
    ...(process.platform === "win32" ? { channel: "msedge" } : {}),
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "npx vite --host 127.0.0.1 --port 3010 --strictPort",
      url: "http://127.0.0.1:3010",
      reuseExistingServer: false,
      env: {
        VITE_FIREBASE_API_KEY: "browser-test-key",
        VITE_FIREBASE_AUTH_DOMAIN: "cone-test.firebaseapp.com",
        VITE_FIREBASE_PROJECT_ID: "cone-test",
        VITE_FIREBASE_APP_ID: "1:123:web:test",
        VITE_ENABLE_DASHBOARD_ROLE_LOGIN: "true",
      },
    },
    {
      command: "npx vite preview --host 127.0.0.1 --port 3011 --strictPort",
      url: "http://127.0.0.1:3011",
      reuseExistingServer: false,
    },
  ],
});
