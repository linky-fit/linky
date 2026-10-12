import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const { beacon, navigateToMock } = vi.hoisted(() => ({
  beacon: { enabled: false },
  navigateToMock: vi.fn(),
}));

vi.mock("../../../hooks/useRouting", () => ({
  navigateTo: navigateToMock,
}));
vi.mock("../useBeacon", () => ({
  useBeacon: () => ({ enabled: beacon.enabled }),
}));

import {
  AtomRegistry,
  RegistryContext,
  useAtomValue,
} from "@linky-fit/linkstr-react";
import { ContactId } from "../../../evoluIds";
import type { Route } from "../../../types/route";
import { contactsGuideAtom } from "../../state/shell/guide";
import { topupAmountAtom } from "../../state/wallet/topup";
import { useContactsGuide } from "./useContactsGuide";
import {
  useContactsGuideOverlay,
  useStartContactsGuide,
} from "./useContactsGuideControls";

const useGuideApi = () => {
  const overlay = useContactsGuideOverlay();
  return {
    contactsGuide: useAtomValue(contactsGuideAtom),
    contactsGuideActiveStep: overlay.activeStep,
    contactsGuideNav: { back: overlay.back, next: overlay.next },
    startContactsGuide: useStartContactsGuide(),
  };
};

type GuideApi = ReturnType<typeof useGuideApi>;

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
  useContactsGuide({
    cashuBalance: 0,
    contacts: [],
    contactsOnboardingHasBackedUpKeys,
    contactsOnboardingHasPaid: false,
    contactsOnboardingHasSentMessage: false,
    openNewContactPage: () => {},
    route,
  });

  onRender(useGuideApi());
  return null;
};

const setup = () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const registry = AtomRegistry.make();

  let api: GuideApi | null = null;

  const render = (
    route: Route,
    contactsOnboardingHasBackedUpKeys = false,
    beaconEnabled = false,
  ): void => {
    beacon.enabled = beaconEnabled;
    act(() => {
      root.render(
        <RegistryContext.Provider value={registry}>
          <Harness
            contactsOnboardingHasBackedUpKeys={
              contactsOnboardingHasBackedUpKeys
            }
            onRender={(value) => {
              api = value;
            }}
            route={route}
          />
        </RegistryContext.Provider>,
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

  return { cleanup, getApi, registry, render };
};

afterEach(() => {
  navigateToMock.mockReset();
  beacon.enabled = false;
  document.body.innerHTML = "";
});

describe("useContactsGuide replay", () => {
  it("walks a task that is already done through every step", () => {
    const { cleanup, getApi, render } = setup();

    render({ kind: "contacts" }, true);
    act(() => {
      getApi().startContactsGuide("backup_keys", true);
    });
    expect(getApi().contactsGuideActiveStep?.step?.id).toBe("backup_keys_1");

    render({ kind: "settings" }, true);
    expect(getApi().contactsGuideActiveStep?.step?.id).toBe("backup_keys_2");

    cleanup();
  });

  it("still ends a task the moment the user completes it", () => {
    const { cleanup, getApi, render } = setup();

    render({ kind: "contacts" });
    act(() => {
      getApi().startContactsGuide("backup_keys");
    });
    render({ kind: "settings" }, true);
    expect(getApi().contactsGuide).toBeNull();

    cleanup();
  });
});

describe("useContactsGuide linky_name task", () => {
  it("follows the user into the profile and its edit form", () => {
    const { cleanup, getApi, render } = setup();

    render({ kind: "contacts" });
    act(() => {
      getApi().startContactsGuide("linky_name");
    });
    expect(getApi().contactsGuideActiveStep?.step?.id).toBe("linky_name_1");

    render({ kind: "profile" });
    expect(getApi().contactsGuideActiveStep?.step?.id).toBe("linky_name_2");

    render({ kind: "profileEdit" });
    expect(getApi().contactsGuideActiveStep?.step?.id).toBe("linky_name_3");

    cleanup();
  });
});

describe("useContactsGuide tasks that start from a contact card", () => {
  const id = ContactId.orThrow("AgICAgICAgICAgICAgICAg");

  it("groups: follows the conversation into the edit form and back", () => {
    const { cleanup, getApi, render } = setup();

    render({ kind: "contacts" });
    act(() => {
      getApi().startContactsGuide("groups");
    });
    expect(getApi().contactsGuideActiveStep?.step?.id).toBe("groups_1");

    // A contact card opens the conversation straight away.
    render({ kind: "chat", id });
    expect(getApi().contactsGuideActiveStep?.step?.id).toBe("groups_2");

    render({ kind: "contactEdit", id });
    expect(getApi().contactsGuideActiveStep?.step?.id).toBe("groups_3");

    navigateToMock.mockClear();
    render({ kind: "contact", id });
    expect(getApi().contactsGuideActiveStep?.step?.id).toBe("groups_4");
    expect(navigateToMock).toHaveBeenCalledWith({ route: "chat", id });

    cleanup();
  });

  it("pay: goes from the conversation to the payment and on to the wallet", () => {
    const { cleanup, getApi, render } = setup();

    render({ kind: "contacts" });
    act(() => {
      getApi().startContactsGuide("pay");
    });
    render({ kind: "chat", id });
    expect(getApi().contactsGuideActiveStep?.step?.id).toBe("pay_2");
    render({ kind: "contactPay", id });
    expect(getApi().contactsGuideActiveStep?.step?.id).toBe("pay_3");

    navigateToMock.mockClear();
    act(() => {
      getApi().contactsGuideNav.next();
    });
    expect(getApi().contactsGuideActiveStep?.step?.id).toBe("pay_4");
    expect(navigateToMock).toHaveBeenCalledWith({ route: "wallet" });

    cleanup();
  });

  it("message: writing and sending is one step in the conversation", () => {
    const { cleanup, getApi, render } = setup();

    render({ kind: "contacts" });
    act(() => {
      getApi().startContactsGuide("message");
    });
    render({ kind: "chat", id });
    expect(getApi().contactsGuideActiveStep?.step?.id).toBe("message_2");
    expect(getApi().contactsGuideActiveStep?.total).toBe(2);

    cleanup();
  });
});

describe("useContactsGuide add_contact and topup tasks", () => {
  it("shows the own QR code first, then the scan on the new contact form", () => {
    const { cleanup, getApi, render } = setup();

    render({ kind: "contacts" });
    act(() => {
      getApi().startContactsGuide("add_contact");
    });
    render({ kind: "profile" });
    expect(getApi().contactsGuideActiveStep?.step?.id).toBe("add_contact_2");

    navigateToMock.mockClear();
    act(() => {
      getApi().contactsGuideNav.next();
    });
    expect(navigateToMock).toHaveBeenCalledWith({ route: "contacts" });
    render({ kind: "contacts" });
    render({ kind: "contactNew" });
    expect(getApi().contactsGuideActiveStep?.step?.id).toBe("add_contact_4");

    render({ kind: "contacts" });
    expect(getApi().contactsGuide).toBeNull();

    cleanup();
  });

  it("topup: fills a sample amount for the invoice, then shows the request", () => {
    const { cleanup, getApi, registry, render } = setup();

    render({ kind: "contacts" });
    act(() => {
      getApi().startContactsGuide("topup");
    });
    render({ kind: "wallet" });
    render({ kind: "topup" });
    expect(getApi().contactsGuideActiveStep?.step?.id).toBe("topup_3");

    navigateToMock.mockClear();
    act(() => {
      getApi().contactsGuideNav.next();
    });
    expect(getApi().contactsGuideActiveStep?.step?.id).toBe("topup_4");
    expect(registry.get(topupAmountAtom)).toBe("10000");
    expect(navigateToMock).toHaveBeenCalledWith({ route: "topupInvoice" });

    act(() => {
      getApi().contactsGuideNav.next();
    });
    expect(getApi().contactsGuideActiveStep?.step?.id).toBe("topup_5");
    expect(getApi().contactsGuideActiveStep?.total).toBe(5);

    cleanup();
  });
});

describe("useContactsGuide proxy_payment and beacon tasks", () => {
  it("advances to the scan step when the user opens proxy payments", () => {
    const { cleanup, getApi, render } = setup();

    render({ kind: "contacts" });
    act(() => {
      getApi().startContactsGuide("proxy_payment");
    });
    expect(getApi().contactsGuideActiveStep?.step?.id).toBe("proxy_payment_1");

    render({ kind: "proxyPayments" });
    expect(getApi().contactsGuideActiveStep?.step?.id).toBe("proxy_payment_2");

    cleanup();
  });

  it("skips the switch step once the beacon is on", () => {
    const { cleanup, getApi, render } = setup();

    render({ kind: "contacts" });
    act(() => {
      getApi().startContactsGuide("beacon");
    });
    render({ kind: "proxyPayments" });
    expect(getApi().contactsGuideActiveStep?.step?.id).toBe("beacon_2");

    render({ kind: "proxyPayments" }, false, true);
    expect(getApi().contactsGuideActiveStep?.step?.id).toBe("beacon_3");

    cleanup();
  });
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
