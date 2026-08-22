import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative base so the static build works from any host path (root or subfolder).
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: { port: 5173, host: true },
  preview: { port: 4173 },
});
