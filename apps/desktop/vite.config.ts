import { readFileSync } from "node:fs";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const rootPackage = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { version: string };
const sentryRequired = process.env.SENTRY_REQUIRED === "true";
const sentryUploadEnabled = Boolean(
  sentryRequired &&
    process.env.VITE_SENTRY_DSN &&
    process.env.SENTRY_AUTH_TOKEN &&
    process.env.SENTRY_ORG &&
    process.env.SENTRY_RENDERER_PROJECT,
);

if (sentryRequired && !sentryUploadEnabled) {
  throw new Error(
    "Sentry renderer configuration is required when SENTRY_REQUIRED=true",
  );
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    ...(sentryUploadEnabled
      ? [
          ...sentryVitePlugin({
            authToken: process.env.SENTRY_AUTH_TOKEN,
            org: process.env.SENTRY_ORG,
            project: process.env.SENTRY_RENDERER_PROJECT,
            release: { name: `launcher@${rootPackage.version}` },
            sourcemaps: {
              filesToDeleteAfterUpload: "dist/**/*.map",
            },
          }),
        ]
      : []),
  ],
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(rootPackage.version),
  },
  build: {
    sourcemap: sentryUploadEnabled ? "hidden" : false,
  },
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
