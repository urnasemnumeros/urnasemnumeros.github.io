import { defineConfig, type Plugin } from "vite";
import { existsSync } from "node:fs";
import { join } from "node:path";

// No servidor local, /raio-x/ e /links/ abrem o index.html da pasta em public/, como no GitHub Pages
// (sem isso o Vite devolve a página principal para qualquer endereço de pasta).
const paginasDePasta = (): Plugin => ({
  name: "paginas-de-pasta",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const url = (req.url ?? "").split("?")[0];
      const pasta = url.replace(/^\/+|\/+$/g, "");
      if (pasta && !pasta.includes(".") && existsSync(join(server.config.publicDir, pasta, "index.html"))) {
        // sem a barra final, redireciona (como o GitHub Pages) para os links relativos da página funcionarem
        if (!url.endsWith("/")) { res.writeHead(301, { Location: `/${pasta}/` }); res.end(); return; }
        req.url = `/${pasta}/index.html`;
      }
      next();
    });
  },
});

// base relativa: o build funciona em qualquer subpasta de hospedagem
export default defineConfig({ base: "./", server: { port: 5173 }, plugins: [paginasDePasta()] });
