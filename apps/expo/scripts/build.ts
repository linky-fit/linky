// Production web build: public/ template, Metro export, service worker, size budget.
// Extra arguments go to `expo export`, e.g. --source-maps.
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";
import { checkBundleSize } from "./bundleSize.ts";
import { preparePublic } from "./preparePublic.ts";
import { buildServiceWorker } from "./serviceWorker.ts";

const root = join(import.meta.dir, "..");
const dist = join(root, "dist");

await preparePublic({ dev: false });
// --clear: Expo inlines EXPO_PUBLIC_* at transform time, and cached transforms
// would keep values from an earlier build.
await $`expo export --platform web --clear ${process.argv.slice(2)}`.cwd(root);
// EAS Update metadata; nothing reads it on the web.
await rm(join(dist, "metadata.json"));
await buildServiceWorker(dist);
await checkBundleSize(dist);
