import { Schema } from "effect";
import { app } from "electron";

const LATEST_RELEASE_URL =
  "https://api.github.com/repos/linky-fit/linky/releases/latest";
const DMG_NAME = "linky-mac-arm64.dmg";
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

const LatestRelease = Schema.Struct({
  tag_name: Schema.String,
  assets: Schema.Array(
    Schema.Struct({ name: Schema.String, browser_download_url: Schema.String }),
  ),
});

export interface AvailableUpdate {
  version: string;
  downloadUrl: string;
}

// Numeric collation orders CalVer parts as numbers, so 26.10.1 > 26.9.21.
const isNewer = (candidate: string, current: string) =>
  candidate.localeCompare(current, "en", { numeric: true }) > 0;

export const fetchAvailableUpdate =
  async (): Promise<AvailableUpdate | null> => {
    const response = await fetch(LATEST_RELEASE_URL, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
    const release = Schema.decodeUnknownSync(LatestRelease)(
      await response.json(),
    );
    const version = release.tag_name.replace(/^v/, "");
    const dmg = release.assets.find(({ name }) => name === DMG_NAME);
    return dmg && isNewer(version, app.getVersion())
      ? { version, downloadUrl: dmg.browser_download_url }
      : null;
  };

/** Reports each newer release once, checking on start and every few hours. */
export const watchForUpdates = (
  onUpdate: (update: AvailableUpdate) => void,
) => {
  if (!app.isPackaged) return;
  let reportedVersion: string | null = null;
  const check = () =>
    fetchAvailableUpdate().then(
      (update) => {
        if (!update || update.version === reportedVersion) return;
        reportedVersion = update.version;
        onUpdate(update);
      },
      (error: unknown) => {
        console.warn("[linky][desktop] update check failed", error);
      },
    );
  void check();
  setInterval(() => void check(), CHECK_INTERVAL_MS);
};
