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

// An iPhone cannot reach this machine's localhost: LINKY_DEV_HOST=<LAN IP>
// points the local service URLs from .env.development at this machine.
if (process.env.LINKY_DEV_HOST) {
  for (const [name, value] of Object.entries(process.env)) {
    if (name.startsWith("EXPO_PUBLIC_") && value)
      process.env[name] = value.replaceAll(
        /\/\/localhost(?=[:/]|$)/g,
        `//${process.env.LINKY_DEV_HOST}`,
      );
  }
}

const config = getDefaultConfig(__dirname);

// Dev bundles read the .env files themselves, over process.env; with the
// files unwatched they fall back to the rewritten process.env.
if (process.env.LINKY_DEV_HOST) {
  config.watcher.additionalExts = config.watcher.additionalExts.filter(
    (ext) => !["env", "local", "development"].includes(ext),
  );
}

// apps/linky-app modules whose Vite implementation Metro replaces. Targets are
// resolved without an extension, so a `.native.tsx` sibling wins on native.
const swappedModules = new Map([
  [
    path.join(webApp, "src/platform/buildEnv.ts"),
    path.join(__dirname, "src/buildEnv"),
  ],
  [
    path.join(webApp, "src/platform/navigation.ts"),
    path.join(__dirname, "src/navigation"),
  ],
]);

// hermesc rejects its import(<runtime path>), and Evolu never runs migrations from files.
const kyselyFileMigrationProvider =
  /\/kysely\/dist\/\w+\/migration\/file-migration-provider\.js$/;

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

// apps/linky-app's .native siblings import native modules only this package
// declares: declaring them there too makes Linux bun installs run out of memory.
const expoEntry = path.join(__dirname, "index.ts");
const resolveFromExpo = (context, moduleName, platform) => {
  try {
    return resolveWithJsFallback(context, moduleName, platform);
  } catch (error) {
    if (platform === "web" || moduleName.startsWith(".")) throw error;
    return context.resolveRequest(
      { ...context, originModulePath: expoEntry },
      moduleName,
      platform,
    );
  }
};

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (emptyModules.has(moduleName)) return { type: "empty" };
  const resolution = resolveFromExpo(context, moduleName, platform);
  if (resolution.type !== "sourceFile") return resolution;
  if (
    platform !== "web" &&
    kyselyFileMigrationProvider.test(resolution.filePath)
  )
    return { type: "empty" };
  const swapped = swappedModules.get(resolution.filePath);
  return swapped
    ? context.resolveRequest(context, swapped, platform)
    : resolution;
};

// Loaded on the first request: `expo export` starts this server too.
config.server.enhanceMiddleware = (metroMiddleware) => {
  let devMiddleware;
  return (req, res, next) => {
    devMiddleware ??= jiti(
      path.join(__dirname, "server/devMiddleware.ts"),
    ).withDevMiddleware(metroMiddleware, {
      port: config.server.port,
      serverRoot: config.server.unstable_serverRoot,
    });
    return devMiddleware(req, res, next);
  };
};

module.exports = config;
