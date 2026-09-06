import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const { navigateToMock } = vi.hoisted(() => ({
  navigateToMock: vi.fn(),
}));

vi.mock("../../../hooks/useRouting", () => ({
  navigateTo: navigateToMock,
}));

import type { Route } from "../../../types/route";
import { useContactsGuide } from "./useContactsGuide";

type GuideApi = ReturnType<typeof useContactsGuide>;

interface HarnessProps {
  contactsOnboardingHasBackedUpKeys: boolean;
  onRender: (api: GuideApi) => void;
  route: Route;
}

const Harness = ({
  contactsOnboardingHasBackedUpKeys,
  onRender,
  route,
}: HarnessProps): null => {
  const api = useContactsGuide({
    cashuBalance: 0,
    contacts: [],
    contactsOnboardingHasBackedUpKeys,
    contactsOnboardingHasPaid: false,
    contactsOnboardingHasSentMessage: false,
    openNewContactPage: () => {},
    route,
  });

  onRender(api);
  return null;
};

const setup = () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  let api: GuideApi | null = null;

  const render = (
    route: Route,
    contactsOnboardingHasBackedUpKeys = false,
  ): void => {
    act(() => {
      root.render(
        <Harness
          contactsOnboardingHasBackedUpKeys={contactsOnboardingHasBackedUpKeys}
          onRender={(value) => {
            api = value;
          }}
          route={route}
        />,
      );
    });
  };

  const getApi = (): GuideApi => {
    if (!api) throw new Error("Guide harness has not rendered yet.");
    return api;
  };

  const cleanup = (): void => {
    act(() => {
      root.unmount();
    });
    container.remove();
  };

  return { cleanup, getApi, render };
};

afterEach(() => {
  navigateToMock.mockReset();
  document.body.innerHTML = "";
});

describe("useContactsGuide backup_keys task", () => {
  it("advances to the master keys step when the user opens settings", () => {
    const { cleanup, getApi, render } = setup();

    render({ kind: "contacts" });
    act(() => {
      getApi().startContactsGuide("backup_keys");
    });

    expect(getApi().contactsGuideActiveStep?.step?.id).toBe("backup_keys_1");

    // The user follows the instruction and taps the menu (gear) button,
    // which navigates to the settings route.
    render({ kind: "settings" });

    expect(getApi().contactsGuideActiveStep?.step?.id).toBe("backup_keys_2");

    cleanup();
  });

  it("does not navigate the user away from settings while on the menu step", () => {
    const { cleanup, getApi, render } = setup();

    render({ kind: "contacts" });
    act(() => {
      getApi().startContactsGuide("backup_keys");
    });

    navigateToMock.mockClear();
    render({ kind: "settings" });

    expect(navigateToMock).not.toHaveBeenCalledWith({ route: "contacts" });

    cleanup();
  });

  it("advances to the copy step when the user opens master keys", () => {
    const { cleanup, getApi, render } = setup();

    render({ kind: "contacts" });
    act(() => {
      getApi().startContactsGuide("backup_keys");
    });
    render({ kind: "settings" });
    render({ kind: "settingsMasterKeys" });

    expect(getApi().contactsGuideActiveStep?.step?.id).toBe("backup_keys_3");

    cleanup();
  });

  it("ensures the settings route when the master keys step is reached via Next", () => {
    const { cleanup, getApi, render } = setup();

    render({ kind: "contacts" });
    act(() => {
      getApi().startContactsGuide("backup_keys");
    });

    navigateToMock.mockClear();
    act(() => {
      getApi().contactsGuideNav.next();
    });

    expect(navigateToMock).toHaveBeenCalledWith({ route: "settings" });

    cleanup();
  });

  it("stops the guide once the keys have been backed up", () => {
    const { cleanup, getApi, render } = setup();

    render({ kind: "contacts" });
    act(() => {
      getApi().startContactsGuide("backup_keys");
    });

    expect(getApi().contactsGuide).not.toBeNull();

    render({ kind: "settingsMasterKeys" }, true);

    expect(getApi().contactsGuide).toBeNull();

    cleanup();
  });
});
