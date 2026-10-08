import { CapacitorHttp, WebView } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { base64 } from "@scure/base";
import { Option, Schema } from "effect";
import { unzipSync } from "fflate";
import { reportAppLog } from "../devtools/inspector/appLog";
import {
  handlePwaUpdateAvailable,
  recordPwaRegistered,
} from "../utils/pwaUpdate";
import { getUnknownErrorMessage } from "../utils/unknown";
import {
  bundleSha256,
  isNewerVersion,
  LIVE_UPDATE_PUBLIC_KEY,
  LiveUpdateManifest,
  liveUpdateAssetName,
  NativeRuntimeFile,
  verifyLiveUpdateManifest,
} from "./liveUpdateManifest";
import { readNativeBuiltinRuntimeFile } from "./nativeBridge";

const RELEASE_ASSETS_URL =
  "https://github.com/linky-fit/linky/releases/latest/download";
const BUNDLES_DIR = "live-updates";
const STAGING_DIR = `${BUNDLES_DIR}/staging`;
const BUILTIN_ASSET_PATH = "public";
const CHECK_INTERVAL_MS = 30 * 60_000;
const MIN_CHECK_GAP_MS = 5 * 60_000;

const decodeRuntimeFile = (json: string | null): string | null =>
  json === null
    ? null
    : (Option.getOrNull(
        Schema.decodeUnknownOption(Schema.parseJson(NativeRuntimeFile))(json),
      )?.runtime ?? null);

// GitHub serves release assets as octet-stream, which CapacitorHttp returns as text.
const decodeManifest = Schema.decodeUnknownSync(
  Schema.Union(LiveUpdateManifest, Schema.parseJson(LiveUpdateManifest)),
);

const bundleDir = (version: string): string => `${BUNDLES_DIR}/${version}`;

const absolutePath = async (path: string): Promise<string> => {
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Data });
  return new URL(uri).pathname;
};

const exists = (path: string): Promise<boolean> =>
  Filesystem.stat({ path, directory: Directory.Data }).then(
    () => true,
    () => false,
  );

const reportFailure = (stage: string, error: unknown): void => {
  reportAppLog({
    tag: "liveUpdate.failed",
    summary: `Live update ${stage} failed`,
    payload: { stage, error: getUnknownErrorMessage(error, "unknown") },
  });
};

/** Deletes downloads that are not newer than the running bundle, keeping the running one. */
const pruneBundles = async (runningLive: boolean): Promise<void> => {
  const { files } = await Filesystem.readdir({
    path: BUNDLES_DIR,
    directory: Directory.Data,
  }).catch(() => ({ files: [] }));
  const stale = files.filter(
    ({ name }) =>
      !(runningLive && name === __APP_VERSION__) &&
      !isNewerVersion(name, __APP_VERSION__),
  );
  await Promise.all(
    stale.map(({ name }) =>
      Filesystem.rmdir({
        path: `${BUNDLES_DIR}/${name}`,
        directory: Directory.Data,
        recursive: true,
      }),
    ),
  );
};

/**
 * A live bundle starts unpersisted, so a bundle that never mounts is dropped on
 * the next launch. Once it mounts and matches the shell it is kept for later launches.
 */
const settleRunningBundle = async (shellRuntime: string): Promise<boolean> => {
  const { path } = await WebView.getServerBasePath();
  const runningLive = path === (await absolutePath(bundleDir(__APP_VERSION__)));
  if (runningLive) {
    const bundleRuntime = decodeRuntimeFile(
      await fetch("/native-runtime.json").then((response) => response.text()),
    );
    if (bundleRuntime !== shellRuntime) {
      reportAppLog({
        tag: "liveUpdate.reverted",
        summary: `Live update ${__APP_VERSION__} does not match this shell; reverting to the built-in bundle`,
        links: { liveUpdate: __APP_VERSION__ },
        payload: { bundleRuntime, shellRuntime, version: __APP_VERSION__ },
      });
      await WebView.setServerAssetPath({ path: BUILTIN_ASSET_PATH });
      return false;
    }
    await WebView.persistServerBasePath();
    reportAppLog({
      tag: "liveUpdate.booted",
      summary: `Running live update ${__APP_VERSION__}`,
      links: { liveUpdate: __APP_VERSION__ },
      payload: { runtime: shellRuntime, version: __APP_VERSION__ },
    });
  }
  await pruneBundles(runningLive);
  return true;
};

const fetchManifest = async (
  shellRuntime: string,
): Promise<LiveUpdateManifest | null> => {
  const response = await CapacitorHttp.get({
    url: `${RELEASE_ASSETS_URL}/${liveUpdateAssetName(shellRuntime, "json")}`,
    responseType: "text",
  });
  // The latest release was built for another runtime: this shell waits for a store update.
  if (response.status === 404) return null;
  if (response.status !== 200) {
    throw new Error(`manifest HTTP ${response.status}`);
  }
  const manifest = decodeManifest(response.data);
  if (
    manifest.runtime !== shellRuntime ||
    !verifyLiveUpdateManifest(manifest, LIVE_UPDATE_PUBLIC_KEY)
  ) {
    throw new Error("manifest signature or runtime rejected");
  }
  return manifest;
};

const downloadBundle = async (
  manifest: LiveUpdateManifest,
): Promise<string> => {
  const target = bundleDir(manifest.version);
  if (await exists(target)) return absolutePath(target);

  const response = await CapacitorHttp.get({
    url: manifest.url,
    responseType: "arraybuffer",
  });
  if (response.status !== 200 || typeof response.data !== "string") {
    throw new Error(`bundle HTTP ${response.status}`);
  }
  const zip = base64.decode(response.data);
  if (bundleSha256(zip) !== manifest.sha256) {
    throw new Error("bundle sha256 does not match the manifest");
  }
  const files = Object.entries(unzipSync(zip)).filter(
    ([name]) => !name.endsWith("/"),
  );
  if (!files.some(([name]) => name === "index.html")) {
    throw new Error("bundle has no index.html");
  }

  await Filesystem.rmdir({
    path: STAGING_DIR,
    directory: Directory.Data,
    recursive: true,
  }).catch(() => undefined);
  for (const [name, bytes] of files) {
    await Filesystem.writeFile({
      path: `${STAGING_DIR}/${name}`,
      data: base64.encode(bytes),
      directory: Directory.Data,
      recursive: true,
    });
  }
  await Filesystem.rename({
    from: STAGING_DIR,
    to: target,
    directory: Directory.Data,
  });

  reportAppLog({
    tag: "liveUpdate.downloaded",
    summary: `Downloaded live update ${manifest.version}`,
    links: { liveUpdate: manifest.version },
    payload: {
      files: files.length,
      runtime: manifest.runtime,
      sha256: manifest.sha256,
      version: manifest.version,
    },
  });
  return absolutePath(target);
};

const applyBundle = async (path: string, version: string): Promise<void> => {
  reportAppLog({
    tag: "liveUpdate.applying",
    summary: `Applying live update ${version}`,
    links: { liveUpdate: version },
    payload: { version },
  });
  // The active service worker would answer the reload from its precache and keep the old bundle running.
  const registrations =
    (await navigator.serviceWorker?.getRegistrations()) ?? [];
  await Promise.all(
    registrations.map((registration) => registration.unregister()),
  );
  await WebView.setServerBasePath({ path });
};

let checking = false;
let lastCheckAt = 0;

const checkForUpdate = async (shellRuntime: string): Promise<void> => {
  if (checking || Date.now() - lastCheckAt < MIN_CHECK_GAP_MS) return;
  checking = true;
  lastCheckAt = Date.now();
  try {
    const manifest = await fetchManifest(shellRuntime);
    if (!manifest || !isNewerVersion(manifest.version, __APP_VERSION__)) {
      return;
    }
    const path = await downloadBundle(manifest);
    recordPwaRegistered(() => applyBundle(path, manifest.version));
    await handlePwaUpdateAvailable();
  } catch (error) {
    reportFailure("check", error);
  } finally {
    checking = false;
  }
};

/**
 * Keeps an Android shell on the newest web bundle built for its native runtime.
 * Call once the app has mounted: that is what marks a freshly applied bundle as good.
 */
export const startNativeLiveUpdates = async (): Promise<void> => {
  const shellRuntime = decodeRuntimeFile(readNativeBuiltinRuntimeFile());
  if (!shellRuntime) return;
  try {
    if (!(await settleRunningBundle(shellRuntime))) return;
  } catch (error) {
    reportFailure("startup", error);
    return;
  }
  const check = () => void checkForUpdate(shellRuntime);
  check();
  setInterval(check, CHECK_INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") check();
  });
};
