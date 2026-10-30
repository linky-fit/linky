import { linkyUi } from "@linky-fit/ui/vite";
import react from "@vitejs/plugin-react-swc";
import type { Plugin } from "vite";
import { defineConfig, loadEnv } from "vite";

const defaultSiteUrl = "https://fazole.fit";

/** Fills `%SITE_URL%` in index.html, so canonical and Open Graph URLs are absolute. */
const siteUrl = (url: string): Plugin => ({
  name: "site-url",
  transformIndexHtml: (html) => html.replaceAll("%SITE_URL%", url),
});

/** Serves `api/contact.ts` in `vite dev` the way Vercel serves it in production, so the form works locally. */
const contactApi = (): Plugin => ({
  name: "contact-api",
  configureServer(server) {
    server.middlewares.use("/api/contact", (req, res) => {
      void (async () => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        }
        const headers = new Headers();
        for (const [name, value] of Object.entries(req.headers)) {
          if (typeof value === "string") headers.set(name, value);
        }
        const method = req.method ?? "GET";
        const { handleContactRequest } = await import("./api/contact.ts");
        const response = await handleContactRequest(
          new Request("http://localhost/api/contact", {
            method,
            headers,
            body: method === "POST" ? Buffer.concat(chunks) : null,
          }),
        );
        res.statusCode = response.status;
        response.headers.forEach((value, name) => res.setHeader(name, value));
        res.end(Buffer.from(await response.arrayBuffer()));
      })().catch((error: unknown) => {
        res.statusCode = 500;
        res.end(String(error));
      });
    });
  },
});

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    plugins: [
      linkyUi(),
      react(),
      siteUrl((env.VITE_SITE_URL || defaultSiteUrl).replace(/\/$/u, "")),
      contactApi(),
    ],
    server: { port: 5300, strictPort: true },
    preview: { port: 5300, strictPort: true },
  };
});
