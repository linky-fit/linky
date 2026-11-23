import { RegistryContext } from "@linky-fit/linkstr-react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { navigateTo } from "../hooks/useRouting";
import { makeTestAppRegistry } from "../testUtils/appRegistry";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { AdvancedPage } from "./AdvancedPage";

const state = vi.hoisted(() => ({
  motionSupported: false,
}));

vi.mock("../app/hooks/shell", async () =>
  (await import("../testUtils/shellHooks")).shellHooksMock({
    displayCurrency: "sat",
    lang: "en",
  }),
);
vi.mock("../app/hooks/settings/useEvoluSettings", () => ({
  useEvoluStatusSummary: () => ({
    evoluConnectedServerCount: 1,
    evoluOverallStatus: "connected",
    evoluServerUrls: ["wss://evolu.example"],
  }),
}));
vi.mock("../app/hooks/settings/useIdentitySettings", () => ({
  useIdentitySettings: () => ({
    requestLogout: vi.fn(),
    seedMnemonic: "abandon abandon abandon",
  }),
}));
vi.mock("../app/hooks/wallet/useDefaultMint", () => ({
  useDefaultMintDisplay: () => "mint.example",
}));
vi.mock("../app/hooks/settings/useDeviceSettings", () => ({
  useSeenReceiptsSetting: () => ({
    sendReadReceiptsEnabled: true,
    toggleSendReadReceipts: vi.fn(),
  }),
  useTiltSetting: () => ({
    showProfileQrOnTiltEnabled: false,
    toggleShowProfileQrOnTilt: vi.fn(),
  }),
}));
vi.mock("../app/hooks/useFeedbackContact", () => ({
  useOpenFeedbackContact: () => vi.fn(),
}));
vi.mock("../app/hooks/useAllowTestMints", () => ({
  useAllowTestMints: () => ({
    allowTestMints: false,
    setAllowTestMints: vi.fn(async () => ({ ok: true as const })),
  }),
}));
vi.mock("../app/hooks/useRelayHealth", () => ({
  countConnectedRelays: () => 1,
  overallRelayStatus: () => "connected",
  useRelayHealth: () => new Map(),
}));
vi.mock("../app/hooks/usePassOnListings", () => ({
  usePassOnListings: () => ({
    passOnListings: false,
    setPassOnListings: vi.fn(async () => ({ ok: true as const })),
  }),
}));
vi.mock("../app/hooks/usePushNotificationsSetting", () => ({
  usePushNotificationsSetting: () => ({
    enabled: false,
    isBusy: false,
    setEnabled: vi.fn(async () => {}),
  }),
}));
vi.mock("../hooks/useColorMode", () => ({
  useColorModePreference: () => "system",
}));
vi.mock("../hooks/useRouting", () => ({
  navigateTo: vi.fn(),
  useRouting: () => ({ kind: "settings" }),
}));
vi.mock("../platform/deviceMotion", () => ({
  supportsDeviceMotion: () => state.motionSupported,
}));
vi.mock("../platform/runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../platform/runtime")>();
  return {
    ...actual,
    isDesktopShell: () => false,
    isNightlyOrigin: () => false,
  };
});
vi.mock("../components/LogoutRow", () => ({
  LogoutRow: () => null,
}));

const renderSettings = () =>
  renderIntoDocument(
    <RegistryContext.Provider value={makeTestAppRegistry()}>
      <AdvancedPage />
    </RegistryContext.Provider>,
  );

const buttonContaining = (container: HTMLElement, text: string) =>
  Array.from(container.querySelectorAll("button")).find((element) =>
    element.textContent?.includes(text),
  );

beforeEach(() => {
  vi.stubGlobal("__APP_VERSION__", "26.11.0");
  vi.stubGlobal("__APP_COMMIT_SHA__", "abc1234");
});

afterEach(() => {
  state.motionSupported = false;
  vi.mocked(navigateTo).mockClear();
  vi.unstubAllGlobals();
});

describe("AdvancedPage", () => {
  it("shows current Language and Units summaries and collapses developer tools behind Developer", async () => {
    const { container } = await renderSettings();

    expect(buttonContaining(container, "language")?.textContent).toContain(
      "english",
    );
    expect(buttonContaining(container, "unit")?.textContent).toContain("sat");
    expect(container.textContent).not.toContain("nostrInspector");
    expect(container.textContent).not.toContain("reloadApp");

    await act(async () => {
      buttonContaining(container, "settingsDeveloper")?.click();
    });
    expect(navigateTo).toHaveBeenCalledWith({ route: "advanced" });
  });

  it("hides Tilt to show profile when motion sensors are unsupported and shows it when supported", async () => {
    state.motionSupported = false;
    const unsupported = await renderSettings();
    expect(unsupported.container.textContent).not.toContain(
      "showProfileQrOnTilt",
    );

    state.motionSupported = true;
    const supported = await renderSettings();
    expect(supported.container.textContent).toContain("showProfileQrOnTilt");
  });
});
