const EVOLU_WORKER =
  /@evolu\/web\/dist\/src\/local-first\/(?:Db|Shared)\.worker\.js$/;

/**
 * Loads the app's polyfills first in Evolu's own workers, which polyfill less
 * than the app supports, such as `Set.prototype.difference` before Safari 17.
 * Pass it to `plugins` and `worker.plugins`, which bundles the workers.
 *
 * @param {string} polyfills absolute path of the polyfill module
 * @returns {{ name: string, transform: (code: string, id: string) => string | null }}
 */
export const evoluWorkerPolyfills = (polyfills) => ({
  name: "evolu-worker-polyfills",
  transform: (code, id) =>
    EVOLU_WORKER.test(id.split("?")[0] ?? id)
      ? `import ${JSON.stringify(polyfills)};\n${code}`
      : null,
});
