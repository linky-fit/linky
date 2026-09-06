import {
  detectTelemetryEnvironment,
  type TelemetryEnvironmentFacts,
} from "./detectTelemetryEnvironment";

const browser = (
  overrides: Partial<TelemetryEnvironmentFacts>,
): TelemetryEnvironmentFacts => ({
  userAgent: "",
  maxTouchPoints: 0,
  displayModeStandalone: false,
  navigatorStandalone: false,
  nativePlatform: null,
  ...overrides,
});

describe("detectTelemetryEnvironment", () => {
  it.each([
    ["Mozilla/5.0 (Linux; Android 14; Pixel 8)", 5, "android"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", 5, "iphone"],
    ["Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0 like Mac OS X)", 5, "iphone"],
    ["Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)", 5, "ipad"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5, "ipad"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0, "mac"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64)", 0, "windows"],
    ["Mozilla/5.0 (X11; Linux x86_64)", 0, "linux"],
    ["Mozilla/5.0 (X11; CrOS x86_64)", 0, "linux"],
    ["Something/1.0", 0, "unknown"],
  ])(
    "maps %s with %d touch points to %s",
    (userAgent, maxTouchPoints, expected) => {
      expect(
        detectTelemetryEnvironment(browser({ userAgent, maxTouchPoints }))
          .devicePlatform,
      ).toBe(expected);
    },
  );

  it("lets the native shell override an uninformative user agent", () => {
    expect(
      detectTelemetryEnvironment(
        browser({ userAgent: "WebView", nativePlatform: "android" }),
      ),
    ).toEqual({ devicePlatform: "android", appRuntime: "native" });
    expect(
      detectTelemetryEnvironment(
        browser({ userAgent: "WebView", nativePlatform: "ios" }),
      ),
    ).toEqual({ devicePlatform: "iphone", appRuntime: "native" });
    expect(
      detectTelemetryEnvironment(
        browser({
          userAgent: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)",
          nativePlatform: "ios",
        }),
      ).devicePlatform,
    ).toBe("ipad");
  });

  it.each([
    [{ displayModeStandalone: true, navigatorStandalone: false }, "pwa"],
    [{ displayModeStandalone: false, navigatorStandalone: true }, "pwa"],
    [{ displayModeStandalone: false, navigatorStandalone: false }, "web"],
  ])("derives the app runtime from %o", (facts, expected) => {
    expect(detectTelemetryEnvironment(browser(facts)).appRuntime).toBe(
      expected,
    );
  });
});
