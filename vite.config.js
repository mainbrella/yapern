import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { handleMessagesRequest } from "./src/messages-api.js";

export default defineConfig({
  base: "/",
  publicDir: "public",
  plugins: [
    {
      name: "live-messages",
      configureServer(server) {
        server.middlewares.use(async (request, response, next) => {
          const url = new URL(request.url, "http://localhost");
          if (url.pathname !== "/api/messages") return next();
          const result = await handleMessagesRequest(
            new Request(url, { method: request.method }),
          );
          response.writeHead(result.status, Object.fromEntries(result.headers));
          response.end(await result.text());
        });
      },
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
        download: fileURLToPath(new URL("./download/index.html", import.meta.url)),
        privacy: fileURLToPath(new URL("./privacy/index.html", import.meta.url)),
        terms: fileURLToPath(new URL("./terms/index.html", import.meta.url)),
      },
    },
  },
});
