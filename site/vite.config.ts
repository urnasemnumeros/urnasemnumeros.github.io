import { defineConfig } from "vite";

// base relativa: o build funciona em qualquer subpasta de hospedagem
export default defineConfig({ base: "./", server: { port: 5173 } });
