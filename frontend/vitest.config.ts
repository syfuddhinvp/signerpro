import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    include: ["{app,components,lib,test}/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["lib/api/**/*.ts", "lib/sf/adapters.ts"],
      exclude: [
        "lib/api/types.ts",          // type declarations only
        "lib/api/client.ts",         // `server-only`: cannot be loaded in jsdom
        "**/*.test.ts",
        "**/*.test.tsx"
      ],
      /**
       * A floor on the two pure modules every screen's correctness rests on.
       * Set just under what the suite achieves today so it ratchets: raise it
       * when coverage rises, never lower it to make a change green.
       */
      thresholds: {
        "lib/api/**/*.ts": { statements: 88, branches: 65, functions: 95, lines: 88 },
        "lib/sf/adapters.ts": { statements: 62, branches: 54, functions: 68, lines: 72 }
      }
    }
  },
  resolve: {
    alias: {
      "@": new URL(".", import.meta.url).pathname
    }
  }
});
