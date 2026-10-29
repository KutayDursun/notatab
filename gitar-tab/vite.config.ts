import { defineConfig } from "vite";
import { alphaTab } from "@coderline/alphatab-vite";

export default defineConfig({
  plugins: [alphaTab()],
  server: {
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
});