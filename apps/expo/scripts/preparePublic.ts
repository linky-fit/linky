// Writes public/, which Expo serves in dev and copies into the export: the
// index.html template, the PWA manifest and the web app's static files.
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { transform } from "esbuild";
import { contentSecurityPolicy } from "@linky-fit/linky-app/server/contentSecurityPolicy.ts";
import { webManifest } from "@linky-fit/linky-app/server/webManifest.ts";

const webApp = dirname(
  Bun.resolveSync("@linky-fit/linky-app/package.json", import.meta.dir),
);
const publicDir = join(import.meta.dir, "../public");
const fromWebApp = (specifier: string): string =>
  Bun.resolveSync(specifier, webApp);

// Same transform as server/bootDiagnosticRedaction.ts in the web app.
const bootDiagnosticRedactionScript = async (): Promise<string> => {
  const source = join(webApp, "src/utils/bootDiagnosticRedaction.ts");
  const { code } = await transform(await Bun.file(source).text(), {
    loader: "ts",
    format: "iife",
    globalName: "linkyBootDiagnostics",
  });
  return `<script>${code}</script>`;
};

const escapeAttribute = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");

/** apps/linky-app/index.html with what the Vite plugins add; Expo appends its bundle scripts. */
const indexHtml = async (dev: boolean): Promise<string> => {
  const source = await Bun.file(join(webApp, "index.html")).text();
  const entry = '<script type="module" src="/src/main.tsx"></script>';
  if (!source.includes(entry)) throw new Error(`index.html lost ${entry}`);
  const html = source
    .replace(entry, "")
    .replace("<head>", `<head>\n${await bootDiagnosticRedactionScript()}`)
    .replace(
      "</head>",
      '<link rel="stylesheet" href="/fonts/manrope.css">\n<link rel="manifest" href="/manifest.webmanifest">\n</head>',
    );
  // Metro dev evaluates lazy bundles with eval(), so CSP is build-only as with Vite.
  if (dev) return html;
  const policy = contentSecurityPolicy(
    html,
    process.env.EXPO_PUBLIC_ALLOW_INSECURE_LOCALHOST_RELAYS === "1",
  );
  return html.replace(
    "<head>",
    `<head>\n<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(policy)}">`,
  );
};

export const preparePublic = async ({ dev }: { dev: boolean }) => {
  await rm(publicDir, { recursive: true, force: true });
  // dereference: Expo copies public/ as is, symlinks included.
  const copy = (from: string, to: string, filter?: (path: string) => boolean) =>
    cp(from, join(publicDir, to), {
      recursive: true,
      dereference: true,
      ...(filter ? { filter } : {}),
    });
  await copy(join(webApp, "public"), ".");
  await copy(
    dirname(fromWebApp("@linky-fit/ui/manrope.css")),
    "fonts",
    (path) => !/\.(md|txt)$/.test(path),
  );
  const pdfWorker = "pdfjs-dist/build/pdf.worker.min.mjs";
  await mkdir(dirname(join(publicDir, "vendor", pdfWorker)), {
    recursive: true,
  });
  await copy(fromWebApp(pdfWorker), join("vendor", pdfWorker));
  await Bun.write(
    join(publicDir, "manifest.webmanifest"),
    JSON.stringify(webManifest),
  );
  await Bun.write(join(publicDir, "index.html"), await indexHtml(dev));
};

if (import.meta.main)
  await preparePublic({ dev: process.argv.includes("--dev") });
