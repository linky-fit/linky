import { describe, expect, it } from "vitest";
import { dispatchBackPress, onBackPress } from "./backPress";

describe("dispatchBackPress", () => {
  it("offers the press newest handler first until one handles it", () => {
    const calls: string[] = [];
    const removeApp = onBackPress(() => {
      calls.push("app");
      return true;
    });
    const removeDialog = onBackPress(() => {
      calls.push("dialog");
      return true;
    });

    expect(dispatchBackPress()).toBe(true);
    expect(calls).toEqual(["dialog"]);

    removeDialog();
    expect(dispatchBackPress()).toBe(true);
    expect(calls).toEqual(["dialog", "app"]);

    removeApp();
    expect(dispatchBackPress()).toBe(false);
  });

  it("falls through handlers that decline the press", () => {
    const remove = [onBackPress(() => true), onBackPress(() => false)];
    expect(dispatchBackPress()).toBe(true);
    for (const unsubscribe of remove) unsubscribe();
    expect(dispatchBackPress()).toBe(false);
  });
});
