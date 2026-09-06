import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import { CONTACTS_ONBOARDING_DISMISSED_STORAGE_KEY } from "../../../utils/constants";
import { useContactsOnboardingProgress } from "./useContactsOnboardingProgress";

type OnboardingProgress = ReturnType<typeof useContactsOnboardingProgress>;

interface HarnessProps {
  dismissedSynced: boolean;
  onProgress: (progress: OnboardingProgress) => void;
  persistDismissed: () => void;
  stopGuide: () => void;
}

const Harness = ({
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

afterEach(() => {
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

    const { root } = await renderIntoDocument(
      <Harness
        dismissedSynced={false}
        onProgress={onProgress}
        persistDismissed={persistDismissed}
        stopGuide={stopGuide}
      />,
    );
    expect(progressSnapshots.at(-1)?.showContactsOnboarding).toBe(true);

    await act(async () => {
      root.render(
        <Harness
          dismissedSynced
          onProgress={onProgress}
          persistDismissed={persistDismissed}
          stopGuide={stopGuide}
        />,
      );
    });

    expect(progressSnapshots.at(-1)?.showContactsOnboarding).toBe(false);
    expect(
      localStorage.getItem(CONTACTS_ONBOARDING_DISMISSED_STORAGE_KEY),
    ).toBe("1");
    expect(stopGuide).toHaveBeenCalled();
    await act(async () => root.unmount());
  });
});
