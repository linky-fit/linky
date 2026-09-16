import { readFile } from "node:fs/promises";
import { transformWithEsbuild, type Plugin } from "vite";

export const bootDiagnosticRedaction = (): Plugin => ({
  name: "boot-diagnostic-redaction",
  async transformIndexHtml() {
    const file = new URL(
      "../src/utils/bootDiagnosticRedaction.ts",
      import.meta.url,
    );
    const { code } = await transformWithEsbuild(
      await readFile(file, "utf8"),
      file.pathname,
      {
        loader: "ts",
        format: "iife",
        globalName: "linkyBootDiagnostics",
      },
    );
    return [{ tag: "script", children: code, injectTo: "head-prepend" }];
  },
});
