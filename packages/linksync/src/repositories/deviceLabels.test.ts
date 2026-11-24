import { describe, expect, it } from "vitest";
import { describeDevice } from "./deviceLabels";

describe("describeDevice", () => {
  it("names an Android phone by its model", () => {
    expect(
      describeDevice(
        "Mozilla/5.0 (Linux; Android 14; SM-A546B Build/UP1A.231005.007) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
      ),
    ).toEqual({
      name: "SM-A546B",
      deviceType: "mobile",
      browserName: "Chrome",
      osName: "Android",
    });
  });

  it("names a device whose model is hidden by its browser and system", () => {
    expect(
      describeDevice(
        "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
      ).name,
    ).toBe("Chrome · Android");
    expect(
      describeDevice(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
      ),
    ).toEqual({
      name: "Safari · macOS",
      deviceType: "desktop",
      browserName: "Safari",
      osName: "macOS",
    });
  });

  it("tells an iPhone from an iPad", () => {
    const iphone = describeDevice(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
    );
    expect(iphone).toMatchObject({
      name: "Safari · iOS",
      deviceType: "mobile",
    });
    expect(
      describeDevice(
        "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1",
      ),
    ).toMatchObject({ name: "Chrome · iOS", deviceType: "tablet" });
  });

  it("leaves a device it knows nothing about unnamed", () => {
    expect(describeDevice("curl/8.0").name).toBeNull();
  });
});
