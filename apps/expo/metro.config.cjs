const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");
const { createJiti } = require("jiti");

// Loads the TypeScript helpers apps/linky-app shares with vite.config.ts.
const jiti = createJiti(__filename, { tryNative: true });
const webApp = path.dirname(
  require.resolve("@linky-fit/linky-app/package.json"),
);
const { appVersion, appCommitSha } = jiti(
  path.join(webApp, "server/buildInfo.ts"),
);
// babel.config.cjs maps __APP_VERSION__ and __APP_COMMIT_SHA__ to these.
process.env.EXPO_PUBLIC_APP_VERSION = appVersion;
process.env.EXPO_PUBLIC_APP_COMMIT_SHA = appCommitSha;

const config = getDefaultConfig(__dirname);

const viteBuildEnv = path.join(webApp, "src/platform/buildEnv.ts");
const expoBuildEnv = path.join(__dirname, "src/buildEnv.ts");

const emptyModules = new Set([
  // Metro does not emit CSS url() assets; index.html links /fonts/manrope.css.
  "@linky-fit/ui/manrope.css",
  // Library workers named by a bare `new URL("x.js", import.meta.url)`, which
  // Metro resolves as packages. None of them ever starts.
  "Db.worker.js",
  "sqlite3-worker1-bundler-friendly.mjs",
  "sqlite3-opfs-async-proxy.js",
]);

const resolveWithJsFallback = (context, moduleName, platform) => {
  try {
    return context.resolveRequest(context, moduleName, platform);
  } catch (error) {
    if (!moduleName.startsWith(".") || !moduleName.endsWith(".js")) throw error;
    // NodeNext packages (linkauth) import their ./x.ts sources as "./x.js".
    return context.resolveRequest(context, moduleName.slice(0, -3), platform);
  }
};

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (emptyModules.has(moduleName)) return { type: "empty" };
  const resolution = resolveWithJsFallback(context, moduleName, platform);
  return resolution.type === "sourceFile" &&
    resolution.filePath === viteBuildEnv
    ? { type: "sourceFile", filePath: expoBuildEnv }
    : resolution;
};

module.exports = config;
