import { themes } from "@linky-fit/ui/tokens";
import { linkyUi } from "@linky-fit/ui/vite";
import react from "@vitejs/plugin-react-swc";
import { readdirSync, readFileSync } from "node:fs";
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

const trailingSlashRedirect = (): Plugin => ({
  name: "trailing-slash-redirect",
  configureServer(server: ViteDevServer) {
    server.middlewares.use(
      (req: IncomingMessage, res: ServerResponse, next: NextFunction) => {
        const url = req.url ?? "";
        if (/^\/(cashu|follow-us|blog(\/[\w-]+)?)$/u.test(url)) {
          res.statusCode = 302;
          res.setHeader("Location", `${url}/`);
          res.end();
          return;
        }

        next();
      },
    );
  },
});

const blogArticleInputs = Object.fromEntries(
  readdirSync(path.resolve(__dirname, "blog"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map(({ name }) => [
      `blog/${name}`,
      path.resolve(__dirname, "blog", name, "index.html"),
    ]),
);

// Mirrors src/colorMode.ts, so every page paints its first frame in the stored color mode.
const colorModeBootScript = (): Plugin => ({
  name: "color-mode-boot-script",
  transformIndexHtml: () => [
    {
      tag: "script",
      injectTo: "head",
      children: `try {
  const stored = localStorage.getItem("linky.color_mode");
  const mode = stored === "light" || stored === "dark" ? stored
    : matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  const background = ${JSON.stringify({ light: themes.light.background, dark: themes.dark.background })}[mode];
  document.documentElement.style.colorScheme = mode;
  document.documentElement.style.backgroundColor = background;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", background);
} catch {}`,
    },
  ],
});

const lnurlProxy = (): Plugin => ({
  name: "lnurl-proxy",
  configureServer(server: ViteDevServer) {
    server.middlewares.use(
      async (req: IncomingMessage, res: ServerResponse, next: NextFunction) => {
        const url = new URL(req.url ?? "", "http://localhost");
        if (url.pathname !== "/api/lnurlp") return next();

        await lnurlpHandler(
          {
            method: req.method ?? "",
            headers: req.headers,
            query: Object.fromEntries(url.searchParams),
          },
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
        ...blogArticleInputs,
        blog: path.resolve(__dirname, "blog/index.html"),
        cashu: path.resolve(__dirname, "cashu/index.html"),
        followUs: path.resolve(__dirname, "follow-us/index.html"),
        main: path.resolve(__dirname, "index.html"),
        privacy: path.resolve(__dirname, "privacy.html"),
      },
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(readRootPackageVersion()),
  },
  plugins: [
    linkyUi(),
    react(),
    colorModeBootScript(),
    trailingSlashRedirect(),
    lnurlProxy(),
  ],
});
