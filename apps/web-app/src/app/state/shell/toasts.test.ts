import { AtomRegistry } from "effect/reactivity";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toastCommandsAtom, toastsAtom } from "./toasts";

const setup = () => {
  const registry = AtomRegistry.make();
  return {
    commands: registry.get(toastCommandsAtom),
    messages: () => registry.get(toastsAtom).map((toast) => toast.message),
  };
};

afterEach(() => {
  vi.useRealTimers();
});

describe("toasts", () => {
  it("keeps the two newest toasts and drops blank ones", () => {
    const { commands, messages } = setup();

    commands.pushToast("one");
    commands.pushToast("  ");
    commands.pushToast("two");
    commands.pushToast("three");

    expect(messages()).toEqual(["two", "three"]);
  });

  it("hides a toast after its duration, longer when it has an action", () => {
    vi.useFakeTimers();
    const { commands, messages } = setup();

    commands.pushToast("plain");
    commands.pushToast("undo", {
      actions: [{ label: "Undo", onClick: () => {} }],
    });
    vi.advanceTimersByTime(2500);
    expect(messages()).toEqual(["undo"]);

    vi.advanceTimersByTime(3500);
    expect(messages()).toEqual([]);
  });
});
