// Bundles linky-app entries Metro does not emit, resolving them as Metro does:
// the Expo buildEnv.ts, inlined EXPO_PUBLIC_*, and sqlite3.wasm from /sqlite-wasm/.
import { dirname, join, resolve } from "node:path";
import type { BuildConfig } from "bun";
import {
  appCommitSha,
  appVersion,
} from "@linky-fit/linky-app/server/buildInfo.ts";

const webApp = dirname(
  Bun.resolveSync("@linky-fit/linky-app/package.json", import.meta.dir),
);
const viteBuildEnv = join(webApp, "src/platform/buildEnv.ts");
const expoBuildEnv = join(import.meta.dir, "../src/buildEnv.ts");

export const bundleWithBun = async (
  entry: string,
  options: Pick<BuildConfig, "outdir" | "naming" | "format">,
): Promise<string> => {
  const built = await Bun.build({
    ...options,
    entrypoints: [join(webApp, entry)],
    target: "browser",
    minify: true,
    // Inlines EXPO_PUBLIC_* as Expo does; unset ones read as undefined.
    env: "EXPO_PUBLIC_*",
    define: {
      "process.env": "{}",
      "process.env.NODE_ENV": '"production"',
      __DEV__: "false",
      __APP_VERSION__: JSON.stringify(appVersion),
      __APP_COMMIT_SHA__: JSON.stringify(appCommitSha),
    },
    plugins: [
      {
        name: "metro-parity",
        setup(build) {
          build.onResolve({ filter: /\/buildEnv$/ }, ({ path, importer }) =>
            resolve(dirname(importer), `${path}.ts`) === viteBuildEnv
              ? { path: expoBuildEnv }
              : undefined,
          );
          build.onLoad(
            { filter: /\/@evolu\/sqlite-wasm\/.*\.mjs$/ },
            async ({ path }) => ({
              contents: (await Bun.file(path).text()).replaceAll(
                "import.meta.url",
                'globalThis.location.origin + "/sqlite-wasm/"',
              ),
              loader: "js",
            }),
          );
        },
      },
    ],
  });
  if (!built.success)
    throw new AggregateError(built.logs, `${entry} build failed`);
  const [output] = built.outputs;
  if (!output) throw new Error(`${entry} produced no output`);
  return output.path;
};
