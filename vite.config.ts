import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: { "/api": "http://127.0.0.1:8080" },
    fs: {
      deny: [
        ".env",
        ".env.*",
        "*.{crt,pem}",
        "**/.git/**",
        "**/storage/**",
        "**/logs/**",
      ],
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Libraries change far less often than the dashboard: in their own
        // files, browsers keep them cached across dashboard releases.
        manualChunks: {
          firebase: ["firebase/app", "firebase/auth"],
          react: ["react", "react-dom", "react-dom/client"],
          icons: ["lucide-react"],
        },
      },
    },
  },
});
