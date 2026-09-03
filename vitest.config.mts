import path from "node:path"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["{app,components,hooks,lib,supabase}/**/*.test.{ts,tsx}"],
          exclude: ["**/*.component.test.tsx"],
        },
      },
      {
        extends: true,
        test: {
          name: "component",
          environment: "jsdom",
          include: ["{app,components,hooks,lib}/**/*.component.test.tsx"],
          setupFiles: ["./vitest.setup.ts"],
        },
      },
    ],
  },
})
