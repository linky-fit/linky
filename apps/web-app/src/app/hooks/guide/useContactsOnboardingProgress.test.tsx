import { RegistryContext } from "@linky-fit/linkstr-react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeTestAppRegistry } from "../../../testUtils/appRegistry";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import { CONTACTS_ONBOARDING_DISMISSED_STORAGE_KEY } from "../../../utils/constants";
import { useContactsOnboardingProgress } from "./useContactsOnboardingProgress";

const beacon = vi.hoisted(() => ({ supported: false }));
vi.mock("../useBeacon", () => ({
  useBeacon: () => ({ enabled: false }),
  useBeaconSupport: () => beacon.supported,
}));

type OnboardingProgress = ReturnType<typeof useContactsOnboardingProgress>;

interface HarnessProps {
  dismissedSynced: boolean;
  onProgress: (progress: OnboardingProgress) => void;
  persistDismissed: () => void;
  stopGuide: () => void;
}

let registry = makeTestAppRegistry();

const Harness = (props: HarnessProps) => (
  <RegistryContext.Provider value={registry}>
    <Progress {...props} />
  </RegistryContext.Provider>
);

const Progress = ({
  dismissedSynced,
  onProgress,
  persistDismissed,
  stopGuide,
}: HarnessProps): null => {
  const progress = useContactsOnboardingProgress({
    cashuBalance: 0,
    contactsCount: 0,
    contactsOnboardingDismissedSynced: dismissedSynced,
    contactsOnboardingHasBackedUpKeys: false,
    contactsOnboardingHasPaid: false,
    contactsOnboardingHasSentMessage: false,
    persistContactsOnboardingDismissed: persistDismissed,
    routeKind: "contacts",
    stopContactsGuide: stopGuide,
    t: (key) => key,
  });
  onProgress(progress);
  return null;
};

beforeEach(() => {
  registry = makeTestAppRegistry();
});

afterEach(() => {
  beacon.supported = false;
  localStorage.clear();
  vi.clearAllMocks();
});

describe("useContactsOnboardingProgress", () => {
  it("migrates an existing local dismissal into Evolu", async () => {
    localStorage.setItem(CONTACTS_ONBOARDING_DISMISSED_STORAGE_KEY, "1");
    const persistDismissed = vi.fn();
    const progressSnapshots: OnboardingProgress[] = [];

    const { root } = await renderIntoDocument(
      <Harness
        dismissedSynced={false}
        onProgress={(value) => progressSnapshots.push(value)}
        persistDismissed={persistDismissed}
        stopGuide={vi.fn()}
      />,
    );

    expect(progressSnapshots.at(-1)?.showContactsOnboarding).toBe(false);
    expect(persistDismissed).toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("adopts a dismissal synced from another device", async () => {
    const persistDismissed = vi.fn();
    const stopGuide = vi.fn();
    const progressSnapshots: OnboardingProgress[] = [];
    const onProgress = (value: OnboardingProgress) =>
      progressSnapshots.push(value);

    const { rerender, root } = await renderIntoDocument(
      <Harness
        dismissedSynced={false}
        onProgress={onProgress}
        persistDismissed={persistDismissed}
        stopGuide={stopGuide}
      />,
    );
    expect(progressSnapshots.at(-1)?.showContactsOnboarding).toBe(true);

    await rerender(
      <Harness
        dismissedSynced
        onProgress={onProgress}
        persistDismissed={persistDismissed}
        stopGuide={stopGuide}
      />,
    );

    expect(progressSnapshots.at(-1)?.showContactsOnboarding).toBe(false);
    expect(
      localStorage.getItem(CONTACTS_ONBOARDING_DISMISSED_STORAGE_KEY),
    ).toBe("1");
    expect(stopGuide).toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("lists the beacon task only where a beacon can run", async () => {
    const snapshots: OnboardingProgress[] = [];
    const { rerender, root } = await renderIntoDocument(
      <Harness
        dismissedSynced={false}
        onProgress={(value) => snapshots.push(value)}
        persistDismissed={vi.fn()}
        stopGuide={vi.fn()}
      />,
    );
    const keys = () =>
      snapshots.at(-1)?.contactsOnboardingTasks.tasks.map((task) => task.key);
    expect(keys()).toEqual([
      "add_contact",
      "message",
      "topup",
      "backup_keys",
      "pay",
      "linky_name",
      "groups",
      "proxy_payment",
    ]);

    beacon.supported = true;
    await rerender(
      <Harness
        dismissedSynced={false}
        onProgress={(value) => snapshots.push(value)}
        persistDismissed={vi.fn()}
        stopGuide={vi.fn()}
      />,
    );
    expect(keys()?.at(-1)).toBe("beacon");
    await act(async () => root.unmount());
  });
});
