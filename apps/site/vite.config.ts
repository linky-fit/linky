import { themes } from "@linky-fit/ui/tokens";
import { linkyUi } from "@linky-fit/ui/vite";
import react from "@vitejs/plugin-react-swc";
import { readdirSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin, ViteDevServer } from "vite";
import { defineConfig, loadEnv } from "vite";
import type { DemoAuthRequest } from "./api/_demoAuth.js";
import { parseJsonObject, type ApiResponse } from "./api/_npubcash.js";
import demoAuthChallengeHandler from "./api/demo-auth/challenge.js";
import demoAuthReceiveHandler from "./api/demo-auth/receive.js";
import demoAuthVerifyHandler from "./api/demo-auth/verify.js";
import linkauthDomainHandler from "./api/linkauth.js";
import lnurlpHandler from "./api/lnurlp.js";
import {
  absolutePreviewImages,
  deploymentOrigin,
} from "./build/previewImages.js";
import {
  loadProfilePicture,
  loadSharedProfile,
  renderProfilePage,
} from "./api/_profilePage.js";

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
        if (/^\/(cashu|follow-us|demo\/auth|blog(\/[\w-]+)?)$/u.test(url)) {
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

const previewImages = (): Plugin => ({
  name: "absolute-preview-images",
  transformIndexHtml: (html) =>
    absolutePreviewImages(html, deploymentOrigin(process.env)),
});

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

const readJsonBody = async (
  req: IncomingMessage,
): Promise<Record<string, unknown> | undefined> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return parseJsonObject(Buffer.concat(chunks).toString("utf8")) ?? undefined;
};

const apiHandlers: Record<
  string,
  (req: DemoAuthRequest, res: ApiResponse) => unknown
> = {
  "/api/lnurlp": lnurlpHandler,
  "/api/demo-auth/challenge": demoAuthChallengeHandler,
  "/api/demo-auth/receive": demoAuthReceiveHandler,
  "/api/demo-auth/verify": demoAuthVerifyHandler,
  "/.well-known/linkauth.json": linkauthDomainHandler,
};

// Stands in for the Vercel functions in `api/`, in `vite` and `vite preview` alike.
const apiRoutes = (): Plugin => {
  const middleware = async (
    req: IncomingMessage,
    res: ServerResponse,
    next: NextFunction,
  ) => {
    const url = new URL(req.url ?? "", "http://localhost");
    const handler = apiHandlers[url.pathname];
    if (!handler) return next();

    await handler(
      {
        method: req.method ?? "",
        headers: req.headers,
        query: Object.fromEntries(url.searchParams),
        body: req.method === "POST" ? await readJsonBody(req) : undefined,
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
  };
  return {
    name: "api-routes",
    configureServer: (server) => void server.middlewares.use(middleware),
    configurePreviewServer: (server) => void server.middlewares.use(middleware),
  };
};

// Stands in for the `/p/:id` rewrites to `api/profile.ts` and `api/profile-picture.ts` in `vercel.json`.
const sharedProfilePages = (): Plugin => {
  const middleware =
    (loadTemplate: (url: string) => Promise<string>) =>
    async (req: IncomingMessage, res: ServerResponse, next: NextFunction) => {
      const url = new URL(req.url ?? "", `http://${req.headers.host}`);
      const [, id, picturePath] =
        /^\/p\/([^/]+)(\/picture)?$/.exec(url.pathname) ?? [];
      if (!id) return next();
      if (picturePath) {
        const picture = await loadProfilePicture(decodeURIComponent(id));
        res.statusCode = picture ? 200 : 404;
        if (picture) res.setHeader("Content-Type", picture.contentType);
        res.end(picture?.bytes);
        return;
      }
      const profile = await loadSharedProfile(decodeURIComponent(id));
      const template = await loadTemplate(url.pathname);
      res.statusCode = profile ? 200 : 404;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(renderProfilePage(template, profile, url.href));
    };
  const readTemplate = (root: string) =>
    readFileSync(path.resolve(root, "p/index.html"), "utf8");
  return {
    name: "shared-profile-pages",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(
        middleware((url) =>
          server.transformIndexHtml(url, readTemplate(__dirname)),
        ),
      );
    },
    configurePreviewServer(server) {
      server.middlewares.use(
        middleware(async () => readTemplate(path.resolve(__dirname, "dist"))),
      );
    },
  };
};

export default defineConfig(({ mode }) => {
  // The api/ handlers read process.env; this lets a git-ignored .env.local feed them in `vite` and `vite preview`.
  Object.assign(process.env, loadEnv(mode, __dirname, "LINKY_DEMO_AUTH_"));
  return {
    build: {
      rollupOptions: {
        input: {
          ...blogArticleInputs,
          blog: path.resolve(__dirname, "blog/index.html"),
          cashu: path.resolve(__dirname, "cashu/index.html"),
          demoAuth: path.resolve(__dirname, "demo/auth/index.html"),
          followUs: path.resolve(__dirname, "follow-us/index.html"),
          main: path.resolve(__dirname, "index.html"),
          privacy: path.resolve(__dirname, "privacy.html"),
          profile: path.resolve(__dirname, "p/index.html"),
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
      previewImages(),
      trailingSlashRedirect(),
      apiRoutes(),
      sharedProfilePages(),
    ],
  };
});
