import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import bks from "@beekeeperstudio/vite-plugin";

export default defineConfig({
  plugins: [vue(), bks()],
  build: {
    // Plugins are loaded locally, so a single larger bundle is fine.
    chunkSizeWarningLimit: 4000,
  },
  test: {
    environment: "node",
    include: ["tests/**/*.spec.ts"],
  },
});
