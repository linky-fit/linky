// Production web build: public/ template, Metro export, CSP, service worker, size budget.
// Extra arguments go to `expo export`, e.g. --source-maps.
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { $ } from "bun";
import { bundleWithBun } from "./bundleWithBun.ts";
import { checkBundleSize } from "./bundleSize.ts";
import { addContentSecurityPolicy, preparePublic } from "./preparePublic.ts";
import { buildServiceWorker } from "./serviceWorker.ts";

// Bun loads .env.<NODE_ENV> at startup, defaulting to .env.development with
// its local services, and expo export inlines whatever EXPO_PUBLIC_* it sees.
if (process.env.NODE_ENV !== "production")
  throw new Error("Run the build with NODE_ENV=production (bun run build).");

const root = join(import.meta.dir, "..");
const dist = join(root, "dist");
const workerDir = await mkdtemp(join(tmpdir(), "linky-evolu-worker-"));

await preparePublic();
// Metro's tree shaking drops worker bundles, so Bun bundles Evolu's database
// worker and babel.config.cjs points the app at it.
const evoluWorker = await bundleWithBun("src/evoluDb.worker.ts", {
  outdir: workerDir,
  naming: "evoluDb.worker-[hash].[ext]",
  format: "esm",
});
const evoluWorkerUrl = `/_expo/static/js/web/${basename(evoluWorker)}`;
// --clear: Expo inlines EXPO_PUBLIC_* at transform time, and cached transforms
// would keep values from an earlier build.
await $`expo export --platform web --clear ${process.argv.slice(2)}`
  .cwd(root)
  .env({
    ...process.env,
    EXPO_UNSTABLE_TREE_SHAKING: "1",
    EXPO_UNSTABLE_METRO_OPTIMIZE_GRAPH: "1",
    LINKY_EVOLU_WORKER_URL: evoluWorkerUrl,
  });
await cp(evoluWorker, join(dist, evoluWorkerUrl));
await rm(workerDir, { recursive: true });
// EAS Update metadata; nothing reads it on the web.
await rm(join(dist, "metadata.json"));
await addContentSecurityPolicy(join(dist, "index.html"));
await buildServiceWorker(dist);
await checkBundleSize(dist);
