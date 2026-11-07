import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @nova26/shared is a TS-source workspace package (main: src/index.ts); exclude it from
// dep pre-bundling so Vite transpiles it like app source.
export default defineConfig({
  plugins: [react()],
  optimizeDeps: { exclude: ["@nova26/shared"], include: ["zod"] },
  server: { port: 5173 },
});
