import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  optimizeDeps: {
    include: ["framer-motion"],
  },
  test: {
    // supabase/functions/**/*.test.ts are Deno tests (run via `deno test`, not vitest) -- they
    // import remote https:// URLs that Node's ESM loader can't resolve, so vitest must never try
    // to collect them. Scoping to src/ explicitly rather than only excluding supabase/ so any
    // future non-src test location doesn't silently get picked up either.
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
  },
});
