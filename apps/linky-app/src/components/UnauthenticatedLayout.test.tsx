import { act, createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReturningOnboardingStep } from "../app/hooks/useProfileAuthDomain";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { emptySlip39Words } from "../utils/slip39Input";
import { UnauthenticatedLayout } from "./UnauthenticatedLayout";

const SHARE_WORDS =
  "academic acid acne acquire acrobat activity actress adapt adequate adjust admit adorn adult advance advocate afraid again agency agree aide".split(
    " ",
  );

const noop = async () => {};

const renderReturning = async (
  step: Partial<ReturningOnboardingStep>,
  overrides: Partial<
    Pick<
      Parameters<typeof UnauthenticatedLayout>[0],
      | "onboardingStep"
      | "onLeaveRestore"
      | "openReturningOnboarding"
      | "pasteReturningSlip39"
      | "setOnboardingStep"
      | "setReturningSlip39Words"
    >
  > = {},
) => {
  const props = {
    confirmPendingOnboardingProfile: noop,
    createNewAccount: noop,
    shufflePendingOnboardingAvatar: vi.fn(),
    lang: "en" as const,
    onboardingIsBusy: false,
    onboardingPhotoInputRef: createRef<null>(),
    onboardingStep: {
      error: null,
      kind: "returning" as const,
      words: emptySlip39Words(),
      ...step,
    },
    openReturningOnboarding: vi.fn(),
    onPendingOnboardingPhotoError: vi.fn(),
    onPendingOnboardingPhotoSelected: vi.fn(),
    pasteReturningSlip39: vi.fn(() => 0),
    pasteReturningSlip39FromClipboard: noop,
    pickPendingOnboardingPhoto: noop,
    savePendingOnboardingBackupToPasswordManager: noop,
    setReturningSlip39Words: vi.fn(),
    setOnboardingStep: vi.fn(),
    setLang: vi.fn(),
    setPendingOnboardingName: vi.fn(),
    submitReturningSlip39: noop,
    t: (key: string) => key,
    ...overrides,
  };
  const view = await renderIntoDocument(<UnauthenticatedLayout {...props} />);
  const word = (index: number) => {
    const input = view.container.querySelector<HTMLInputElement>(
      `#onboarding-return-word-${index}`,
    );
    if (!input) throw new Error(`word ${index} missing`);
    return input;
  };
  const submit = () => {
    const button = Array.from(view.container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "onboardingReturnConfirm",
    );
    if (!button) throw new Error("submit missing");
    return button;
  };
  return { ...view, props, submit, word };
};

afterEach(() => {
  document.body.innerHTML = "";
});

it("lists twenty word slots and keeps Continue off until all hold listed words", async () => {
  const view = await renderReturning({});
  expect(view.word(1)).toBeDefined();
  expect(view.word(20)).toBeDefined();
  expect(view.submit().disabled).toBe(true);
  expect(view.container.textContent).toContain("onboardingReturnAcademicHint");
  await view.unmount();

  const complete = await renderReturning({ words: SHARE_WORDS });
  expect(complete.submit().disabled).toBe(false);
  await complete.unmount();
});

it("fans a phrase typed into the first slot out over the grid", async () => {
  const view = await renderReturning({});
  const setter = vi.mocked(view.props.setReturningSlip39Words);
  const nativeSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;

  await act(async () => {
    nativeSetter?.call(view.word(1), SHARE_WORDS.join(" "));
    view.word(1).dispatchEvent(new Event("input", { bubbles: true }));
  });

  expect(setter).toHaveBeenCalledExactlyOnceWith(SHARE_WORDS);
  await view.unmount();
});

it("marks an unknown word and names it in the shared message", async () => {
  const words = [...SHARE_WORDS];
  words[4] = "acrobatz";
  const view = await renderReturning({ words });

  expect(view.word(5).getAttribute("aria-invalid")).toBe("true");
  expect(view.word(4).getAttribute("aria-invalid")).toBe("false");
  expect(view.container.textContent).toContain("onboardingReturnUnknownWords");
  expect(view.submit().disabled).toBe(true);
  await view.unmount();
});

it("hands a paste into any slot to the paste handler from that slot", async () => {
  const pasteReturningSlip39 = vi.fn(() => 7);
  const view = await renderReturning({}, { pasteReturningSlip39 });

  await act(async () => {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { getData: () => "acid acne" },
    });
    view.word(6).dispatchEvent(event);
  });

  expect(pasteReturningSlip39).toHaveBeenCalledExactlyOnceWith("acid acne", 5);
  await view.unmount();
});

describe("restore only", () => {
  it("opens the restore step and never offers to create an account", async () => {
    const openReturningOnboarding = vi.fn();
    const view = await renderReturning(
      {},
      {
        onboardingStep: null,
        onLeaveRestore: vi.fn(),
        openReturningOnboarding,
      },
    );

    expect(openReturningOnboarding).toHaveBeenCalled();
    expect(view.container.textContent).not.toContain("onboardingCreate");
    await view.unmount();
  });

  it("leaves the restore step through onLeaveRestore instead of the welcome screen", async () => {
    const onLeaveRestore = vi.fn();
    const setOnboardingStep = vi.fn();
    const view = await renderReturning(
      {},
      { onLeaveRestore, setOnboardingStep },
    );

    const back = view.container.querySelector('[aria-label="back"]');
    if (!back) throw new Error("back missing");
    await act(async () => {
      back.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onLeaveRestore).toHaveBeenCalledTimes(1);
    expect(setOnboardingStep).not.toHaveBeenCalled();
    await view.unmount();
  });
});
