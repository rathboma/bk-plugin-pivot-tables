import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// Dev host that emulates Beekeeper Studio: open http://localhost:5199/dev/host.html
export default defineConfig({
  plugins: [vue()],
  server: { port: 5199 },
});
