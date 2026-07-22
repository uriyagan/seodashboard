import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import path from "node:path";

export default defineConfig({
  base: "/",
  plugins: [
    react(),
    tailwindcss(),
    // yoastseo (loaded in the browser) imports Node's `url`; polyfill just that.
    nodePolyfills({
      include: ["url"],
      globals: { Buffer: false, global: false, process: false },
    }),
    cloudflare(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
