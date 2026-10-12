// Maps the two Vite-only constructs apps/linky-app keeps outside buildEnv.ts.
const viteCompat = ({ types: t }) => {
  const appGlobals = new Map([
    ["__APP_VERSION__", "EXPO_PUBLIC_APP_VERSION"],
    ["__APP_COMMIT_SHA__", "EXPO_PUBLIC_APP_COMMIT_SHA"],
  ]);
  const processEnv = (name) =>
    t.memberExpression(
      t.memberExpression(t.identifier("process"), t.identifier("env")),
      t.identifier(name),
    );
  const isImportMetaUrl = ({ object, property }) =>
    t.isMetaProperty(object) &&
    object.meta.name === "import" &&
    object.property.name === "meta" &&
    t.isIdentifier(property, { name: "url" });
  const origin = t.memberExpression(
    t.memberExpression(t.identifier("globalThis"), t.identifier("location")),
    t.identifier("origin"),
  );

  return {
    name: "linky-vite-compat",
    visitor: {
      // Vite `define`s; metro.config.cjs sets the env vars Expo then inlines.
      ReferencedIdentifier(path) {
        const env = appGlobals.get(path.node.name);
        if (env && !path.scope.hasBinding(path.node.name, true))
          path.replaceWith(processEnv(env));
      },
      // Metro's import.meta.url is the entry bundle's URL. Files located
      // relative to it are served from fixed public paths instead:
      // sqlite3.wasm from /sqlite-wasm/, other package files from /vendor/.
      MemberExpression(path, state) {
        if (!isImportMetaUrl(path.node)) return;
        const base = state.filename.includes("/@evolu/sqlite-wasm/")
          ? "/sqlite-wasm/"
          : "/vendor/";
        path.replaceWith(
          t.binaryExpression("+", origin, t.stringLiteral(base)),
        );
      },
    },
  };
};

module.exports = (api) => {
  api.cache(true);
  return { presets: ["babel-preset-expo"], plugins: [viteCompat] };
};
