import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, lazyPlugins } from "vite-plus";

const generated = ["dist/**", "src/routeTree.gen.ts"];

// https://viteplus.dev/config/
export default defineConfig({
  fmt: {
    ignorePatterns: generated,
  },
  lint: {
    ignorePatterns: generated,
    plugins: ["react", "typescript", "oxc"],
    rules: {
      "react/rules-of-hooks": "error",
      "react/only-export-components": [
        "warn",
        {
          allowConstantExport: true,
        },
      ],
      "vite-plus/prefer-vite-plus-imports": "error",
    },
    overrides: [
      {
        // TanStack route files export `Route` next to their component by design;
        // autoCodeSplitting moves the component into its own chunk anyway.
        files: ["src/routes/**"],
        rules: { "react/only-export-components": "off" },
      },
    ],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    jsPlugins: [
      {
        name: "vite-plus",
        specifier: "vite-plus/oxlint-plugin",
      },
    ],
  },
  // File-based routes in src/routes; the router plugin must run before React's.
  plugins: lazyPlugins(() => [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
  ]),
  server: {
    // `cargo run` in ../server listens on 8080 during development.
    proxy: {
      "/api": "http://127.0.0.1:8080",
    },
  },
});
