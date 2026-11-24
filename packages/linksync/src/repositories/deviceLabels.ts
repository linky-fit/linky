/** What a device says about itself in its row, and the name it starts with. */
export interface DeviceLabels {
  readonly name: string | null;
  readonly deviceType: string | null;
  readonly browserName: string | null;
  readonly osName: string | null;
}

const label = (value: string | null): string | null => {
  const trimmed = value?.trim().slice(0, 100) ?? "";
  return trimmed === "" ? null : trimmed;
};

// Order matters: Edge and Opera also say Chrome, Chrome also says Safari.
const browsers: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bEdgA?\//, "Edge"],
  [/\b(?:OPR|Opera)\//, "Opera"],
  [/\bSamsungBrowser\//, "Samsung Internet"],
  [/\b(?:Firefox|FxiOS)\//, "Firefox"],
  [/\b(?:Chrome|CriOS)\//, "Chrome"],
  [/\bVersion\/[\d.]+.*\bSafari\//, "Safari"],
];

const systems: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(?:iPhone|iPad|iPod)\b/, "iOS"],
  [/\bAndroid\b/, "Android"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bWindows\b/, "Windows"],
  [/\bMac OS X\b|\bMacintosh\b/, "macOS"],
  [/\bLinux\b/, "Linux"],
];

const firstMatch = (
  userAgent: string,
  candidates: ReadonlyArray<readonly [RegExp, string]>,
): string | null =>
  candidates.find(([pattern]) => pattern.test(userAgent))?.[1] ?? null;

// Chrome's reduced UA reports every Android phone as "K".
const androidModel = (userAgent: string): string | null => {
  const model =
    /\bAndroid [\d.]+; (?:[a-z]{2}[-_][a-z]{2}; )?([^;)]+?)(?: Build\/[^;)]*)?\)/i
      .exec(userAgent)?.[1]
      ?.trim();
  return model === undefined || model === "K" || model === "wv" ? null : model;
};

const deviceType = (userAgent: string, os: string | null): string => {
  if (/\biPad\b/.test(userAgent)) return "tablet";
  if (os === "Android")
    return /\bMobile\b/.test(userAgent) ? "mobile" : "tablet";
  return os === "iOS" ? "mobile" : "desktop";
};

/**
 * What a browser says about the device it runs on, and the name a new device
 * starts with: its model when the browser tells it ("SM-A546B"), else its
 * browser and system ("Chrome · macOS"), else none, for the caller's fallback.
 * Language-neutral, since the name syncs to devices set to other languages.
 */
export const describeDevice = (userAgent: string): DeviceLabels => {
  const browserName = firstMatch(userAgent, browsers);
  const osName = firstMatch(userAgent, systems);
  const model = osName === "Android" ? androidModel(userAgent) : null;
  const name =
    model ??
    (browserName !== null && osName !== null
      ? `${browserName} · ${osName}`
      : (osName ?? browserName));
  return {
    name,
    deviceType: label(deviceType(userAgent, osName)),
    browserName: label(browserName),
    osName: label(osName),
  };
};
