import react from "@vitejs/plugin-react-swc";
import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin, ViteDevServer } from "vite";
import { defineConfig } from "vite";
import { parseJsonObject } from "./api/_npubcash.js";
import lnurlpHandler from "./api/lnurlp.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type NextFunction = () => void;

const readRootPackageVersion = (): string => {
  const rootPackage = parseJsonObject(
    readFileSync(path.resolve(__dirname, "../../package.json"), "utf8"),
  );
  const version = rootPackage?.version;
  if (typeof version !== "string") {
    throw new Error("Root package.json has no version");
  }
  return version;
};

const cashuRedirect = (): Plugin => ({
  name: "cashu-redirect",
  configureServer(server: ViteDevServer) {
    server.middlewares.use(
      (req: IncomingMessage, res: ServerResponse, next: NextFunction) => {
        const url = req.url ?? "";
        if (url === "/cashu") {
          res.statusCode = 302;
          res.setHeader("Location", "/cashu/");
          res.end();
          return;
        }

        next();
      },
    );
  },
});

const lnurlProxy = (): Plugin => ({
  name: "lnurl-proxy",
  configureServer(server: ViteDevServer) {
    server.middlewares.use(
      async (req: IncomingMessage, res: ServerResponse, next: NextFunction) => {
        const url = new URL(req.url ?? "", "http://localhost");
        if (url.pathname !== "/api/lnurlp") return next();

        if (req.method !== "GET") {
          res.statusCode = 405;
          res.end("Method not allowed");
          return;
        }

        await lnurlpHandler(
          { query: Object.fromEntries(url.searchParams) },
          {
            setHeader: (name, value) => {
              res.setHeader(name, value);
            },
            status: (code) => {
              res.statusCode = code;
              return {
                json: (body) => {
                  res.setHeader("Content-Type", "application/json");
                  res.end(JSON.stringify(body));
                },
                send: (body) => {
                  res.end(body);
                },
              };
            },
          },
        );
      },
    );
  },
});

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        cashu: path.resolve(__dirname, "cashu/index.html"),
        main: path.resolve(__dirname, "index.html"),
        privacy: path.resolve(__dirname, "privacy.html"),
      },
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(readRootPackageVersion()),
  },
  plugins: [react(), cashuRedirect(), lnurlProxy()],
});
