import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// https://vitejs.dev/config/
export default defineConfig(({ command }) => ({
  // Dev serves at "/" for a clean localhost URL; production builds get the
  // GitHub Pages project path so asset URLs resolve under un1tone.github.io/Pocket-Skater/.
  base: command === "build" ? "/Pocket-Skater/" : "/",
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  optimizeDeps: {
    // Havok ships a wasm + ESM loader that must not be pre-bundled.
    exclude: ["@babylonjs/havok"],
  },
  build: {
    target: "es2020",
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
        manualChunks: {
          babylon: ["@babylonjs/core", "@babylonjs/loaders", "@babylonjs/materials"],
          recast: ["recast-detour"],
          react: ["react", "react-dom", "styled-components", "zustand"],
        },
      },
    },
  },
  server: { host: true },
}));
