import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

function boardPageRoutes(server) {
  server.middlewares.use((request, response, next) => {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname.startsWith("/boards/")) {
      request.url = `/board.html${url.search}`;
    }
    next();
  });
}

export default defineConfig({
  base: "/",
  publicDir: "public",
  plugins: [
    {
      name: "board-page-routes",
      configureServer: boardPageRoutes,
      configurePreviewServer: boardPageRoutes,
    },
    {
      name: "page-redirects",
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          const match = request.url?.match(/^\/(privacy|terms|download)(\?.*)?$/);
          if (!match) {
            next();
            return;
          }
          response.writeHead(308, {
            Location: `/${match[1]}/${match[2] ?? ""}`,
          });
          response.end();
        });
      },
    },
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        board: fileURLToPath(new URL("./board.html", import.meta.url)),
        download: fileURLToPath(new URL("./download/index.html", import.meta.url)),
        privacy: fileURLToPath(new URL("./privacy/index.html", import.meta.url)),
        terms: fileURLToPath(new URL("./terms/index.html", import.meta.url)),
      },
    },
  },
});
