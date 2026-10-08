import { base64 } from "@scure/base";
import { strToU8, zipSync } from "fflate";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import {
  bundleSha256,
  signLiveUpdateManifest,
  type LiveUpdateManifest,
} from "./liveUpdateManifest";

const TEST_SECRET_KEY = "01".repeat(32);
const SHELL_RUNTIME = "0123456789abcdef";
const DATA_DIR = "/data/files";

const mocks = vi.hoisted(() => ({
  httpGet: vi.fn(),
  getServerBasePath: vi.fn(),
  setServerBasePath: vi.fn(),
  persistServerBasePath: vi.fn(),
  writeFile: vi.fn(),
  rename: vi.fn(),
  rmdir: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
  readBuiltinRuntime: vi.fn<() => string | null>(),
  reportAppLog: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({
  CapacitorHttp: { get: mocks.httpGet },
  WebView: {
    getServerBasePath: mocks.getServerBasePath,
    persistServerBasePath: mocks.persistServerBasePath,
    setServerBasePath: mocks.setServerBasePath,
  },
}));

vi.mock("@capacitor/filesystem", () => ({
  Directory: { Data: "DATA" },
  Filesystem: {
    getUri: ({ path }: { path: string }) =>
      Promise.resolve({ uri: `file://${DATA_DIR}/${path}` }),
    readdir: mocks.readdir,
    rename: mocks.rename,
    rmdir: mocks.rmdir,
    stat: mocks.stat,
    writeFile: mocks.writeFile,
  },
}));

vi.mock("./nativeBridge", () => ({
  NATIVE_RESUME_EVENT: "linky-native-resume",
  readNativeBuiltinRuntimeFile: mocks.readBuiltinRuntime,
}));

vi.mock("../devtools/inspector/appLog", () => ({
  reportAppLog: mocks.reportAppLog,
}));

vi.mock("./liveUpdateManifest", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("./liveUpdateManifest")>();
  return {
    ...original,
    LIVE_UPDATE_PUBLIC_KEY: original.liveUpdatePublicKey("01".repeat(32)),
  };
});

const bundle = zipSync({
  "index.html": strToU8("<html></html>"),
  "assets/app.js": strToU8("console.log('next')"),
  "native-runtime.json": strToU8(JSON.stringify({ runtime: SHELL_RUNTIME })),
});

const signedManifest = (
  overrides: Partial<Omit<LiveUpdateManifest, "signature">> = {},
  secretKey = TEST_SECRET_KEY,
): LiveUpdateManifest =>
  signLiveUpdateManifest(
    {
      runtime: SHELL_RUNTIME,
      version: "26.10.4",
      url: "https://example.test/live-update.zip",
      sha256: bundleSha256(bundle),
      ...overrides,
    },
    secretKey,
  );

const serveRelease = (manifest: LiveUpdateManifest | null, zip = bundle) => {
  mocks.httpGet.mockImplementation(({ url }: { url: string }) => {
    if (url.endsWith(`live-update-${SHELL_RUNTIME}.json`)) {
      return Promise.resolve(
        manifest
          ? { status: 200, data: JSON.stringify(manifest) }
          : { status: 404, data: "" },
      );
    }
    // Android wraps the base64 body at 76 characters.
    return Promise.resolve({
      status: 200,
      data: base64.encode(zip).replace(/.{76}/g, "$&\n"),
    });
  });
};

const loadModules = async () => {
  vi.resetModules();
  const pwaUpdate = await import("../utils/pwaUpdate");
  const liveUpdate = await import("./nativeLiveUpdate");
  return {
    pwaUpdate,
    startNativeLiveUpdates: liveUpdate.startNativeLiveUpdates,
  };
};

const waitForCheck = () =>
  vi.waitFor(() => {
    expect(mocks.httpGet).toHaveBeenCalled();
  });

describe("startNativeLiveUpdates", () => {
  let addWindowListener: MockInstance<typeof window.addEventListener>;

  beforeEach(() => {
    addWindowListener = vi.spyOn(window, "addEventListener");
    localStorage.clear();
    vi.useFakeTimers({ toFake: ["setInterval", "Date"] });
    vi.stubGlobal("__APP_VERSION__", "26.10.3");
    vi.stubEnv("DEV", false);
    mocks.readBuiltinRuntime.mockReturnValue(
      JSON.stringify({ runtime: SHELL_RUNTIME }),
    );
    mocks.getServerBasePath.mockResolvedValue({ path: "public" });
    mocks.readdir.mockResolvedValue({ files: [] });
    mocks.stat.mockRejectedValue(new Error("missing"));
    mocks.rmdir.mockResolvedValue(undefined);
    mocks.writeFile.mockResolvedValue({ uri: "" });
    mocks.rename.mockResolvedValue(undefined);
    mocks.setServerBasePath.mockResolvedValue(undefined);
  });

  afterEach(() => {
    for (const [type, listener] of addWindowListener.mock.calls) {
      window.removeEventListener(type, listener);
    }
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetAllMocks();
    vi.restoreAllMocks();
  });

  it("does nothing in a shell without a native runtime", async () => {
    mocks.readBuiltinRuntime.mockReturnValue(null);
    const { startNativeLiveUpdates } = await loadModules();

    await startNativeLiveUpdates();

    expect(mocks.httpGet).not.toHaveBeenCalled();
    expect(mocks.getServerBasePath).not.toHaveBeenCalled();
  });

  it("downloads a newer signed bundle, offers it and switches the web view to it on apply", async () => {
    serveRelease(signedManifest());
    const unregister = vi.fn(() => Promise.resolve(true));
    vi.stubGlobal("navigator", {
      serviceWorker: {
        getRegistrations: () => Promise.resolve([{ unregister }]),
      },
    });
    const { pwaUpdate, startNativeLiveUpdates } = await loadModules();
    const needRefresh: boolean[] = [];
    pwaUpdate.subscribePwaNeedRefresh((value) => needRefresh.push(value));
    // The update reaches the banner instead of applying itself on launch.
    window.dispatchEvent(new Event("pointerdown"));

    await startNativeLiveUpdates();
    await vi.waitFor(() => expect(needRefresh).toEqual([false, true]));

    expect(
      mocks.writeFile.mock.calls.map(([options]) => options.path).sort(),
    ).toEqual([
      "live-updates/staging/assets/app.js",
      "live-updates/staging/index.html",
      "live-updates/staging/native-runtime.json",
    ]);
    expect(mocks.rename).toHaveBeenCalledWith({
      from: "live-updates/staging",
      to: "live-updates/26.10.4",
      directory: "DATA",
    });
    expect(mocks.setServerBasePath).not.toHaveBeenCalled();

    await pwaUpdate.applyPwaUpdate();

    expect(localStorage.getItem("linky.liveUpdate.pendingVersion")).toBe(
      "26.10.4",
    );
    expect(unregister).toHaveBeenCalled();
    expect(mocks.setServerBasePath).toHaveBeenCalledWith({
      path: `${DATA_DIR}/live-updates/26.10.4`,
    });
  });

  it("reuses a bundle downloaded earlier", async () => {
    serveRelease(signedManifest());
    mocks.stat.mockResolvedValue({});
    const { pwaUpdate, startNativeLiveUpdates } = await loadModules();
    const needRefresh: boolean[] = [];
    pwaUpdate.subscribePwaNeedRefresh((value) => needRefresh.push(value));

    await startNativeLiveUpdates();
    await vi.waitFor(() => expect(needRefresh).toContain(true));

    expect(mocks.httpGet).toHaveBeenCalledTimes(1);
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it.each([
    ["the latest release targets another runtime", null, bundle, false],
    [
      "the manifest is signed with another key",
      signedManifest({}, "02".repeat(32)),
      bundle,
      true,
    ],
    [
      "the manifest names another runtime",
      signedManifest({ runtime: "fedcba9876543210" }),
      bundle,
      true,
    ],
    [
      "the version is not newer",
      signedManifest({ version: "26.10.3" }),
      bundle,
      false,
    ],
    [
      "the bundle does not match its hash",
      signedManifest(),
      zipSync({ "index.html": strToU8("tampered") }),
      true,
    ],
  ])(
    "keeps the running bundle when %s",
    async (_, manifest, zip, reportsFailure) => {
      serveRelease(manifest, zip);
      const { pwaUpdate, startNativeLiveUpdates } = await loadModules();
      const needRefresh: boolean[] = [];
      pwaUpdate.subscribePwaNeedRefresh((value) => needRefresh.push(value));

      await startNativeLiveUpdates();
      await waitForCheck();
      if (reportsFailure) {
        await vi.waitFor(() =>
          expect(mocks.reportAppLog).toHaveBeenCalledWith(
            expect.objectContaining({ tag: "liveUpdate.failed" }),
          ),
        );
      } else {
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(mocks.reportAppLog).not.toHaveBeenCalled();
      }

      expect(mocks.writeFile).not.toHaveBeenCalled();
      expect(mocks.rename).not.toHaveBeenCalled();
      expect(needRefresh).toEqual([false]);
    },
  );

  it("keeps a live bundle that mounted and matches the shell, and prunes older downloads", async () => {
    serveRelease(null);
    localStorage.setItem("linky.liveUpdate.pendingVersion", "26.10.3");
    mocks.getServerBasePath.mockResolvedValue({
      path: `${DATA_DIR}/live-updates/26.10.3`,
    });
    mocks.readdir.mockResolvedValue({
      files: [
        { name: "26.10.2" },
        { name: "26.10.3" },
        { name: "26.10.5" },
        { name: "staging" },
      ],
    });
    const { startNativeLiveUpdates } = await loadModules();

    await startNativeLiveUpdates();

    expect(mocks.persistServerBasePath).toHaveBeenCalled();
    expect(localStorage.getItem("linky.liveUpdate.pendingVersion")).toBeNull();
    expect(localStorage.getItem("linky.liveUpdate.rejectedVersion")).toBeNull();
    expect(mocks.rmdir.mock.calls.map(([options]) => options.path)).toEqual([
      "live-updates/26.10.2",
      "live-updates/staging",
    ]);
    await waitForCheck();
  });

  it("rejects a bundle built for other native code without leaving the running bundle", async () => {
    const foreignBundle = zipSync({
      "index.html": strToU8("<html></html>"),
      "native-runtime.json": strToU8(
        JSON.stringify({ runtime: "fedcba9876543210" }),
      ),
    });
    serveRelease(
      signedManifest({ sha256: bundleSha256(foreignBundle) }),
      foreignBundle,
    );
    const { pwaUpdate, startNativeLiveUpdates } = await loadModules();
    const needRefresh: boolean[] = [];
    pwaUpdate.subscribePwaNeedRefresh((value) => needRefresh.push(value));

    await startNativeLiveUpdates();
    await vi.waitFor(() =>
      expect(localStorage.getItem("linky.liveUpdate.rejectedVersion")).toBe(
        "26.10.4",
      ),
    );

    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(mocks.setServerBasePath).not.toHaveBeenCalled();
    expect(needRefresh).toEqual([false]);
  });

  it("rejects a bundle that was applied but never mounted and stops offering it", async () => {
    serveRelease(signedManifest());
    localStorage.setItem("linky.liveUpdate.pendingVersion", "26.10.4");
    mocks.readdir.mockResolvedValue({ files: [{ name: "26.10.4" }] });
    mocks.stat.mockResolvedValue({});
    const { pwaUpdate, startNativeLiveUpdates } = await loadModules();
    const needRefresh: boolean[] = [];
    pwaUpdate.subscribePwaNeedRefresh((value) => needRefresh.push(value));

    await startNativeLiveUpdates();
    await waitForCheck();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(localStorage.getItem("linky.liveUpdate.rejectedVersion")).toBe(
      "26.10.4",
    );
    expect(mocks.rmdir.mock.calls.map(([options]) => options.path)).toEqual([
      "live-updates/26.10.4",
    ]);
    expect(needRefresh).toEqual([false]);
  });

  it("checks again when the app returns to the foreground", async () => {
    serveRelease(null);
    const { startNativeLiveUpdates } = await loadModules();

    await startNativeLiveUpdates();
    await waitForCheck();
    window.dispatchEvent(new Event("linky-native-resume"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.httpGet).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5 * 60_000);
    window.dispatchEvent(new Event("linky-native-resume"));
    await vi.waitFor(() => expect(mocks.httpGet).toHaveBeenCalledTimes(2));
  });
});
