// @vitest-environment jsdom
import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import type { Route } from "../types/route";
import { navigateTo, useRouting } from "./useRouting";

describe("navigateTo", () => {
  afterEach(() => {
    window.location.hash = "";
  });

  it("opens a new recurring payment prefilled with a contact and amount", () => {
    navigateTo({
      route: "recurringPaymentNew",
      prefill: { contactId: "contact-1", amountSat: 10 },
    });
    expect(window.location.hash).toBe(
      "#wallet/recurring/new?contact=contact-1&amount=10",
    );
  });

  it("replaces the current history entry when asked to", () => {
    window.location.hash = "#wallet";
    const length = window.history.length;
    navigateTo({ route: "collaboration" }, { replace: true });
    expect(window.location.hash).toBe("#collaboration");
    expect(window.history.length).toBe(length);
  });
});

describe("useRouting", () => {
  afterEach(() => {
    window.location.hash = "";
    vi.restoreAllMocks();
  });

  it("shares a single hashchange listener across callers and removes it on unmount", async () => {
    window.location.hash = "#wallet";
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");

    const seen: Array<Route | null> = [null, null, null];
    const Subscriber = ({ index }: { index: number }) => {
      const route = useRouting();
      React.useEffect(() => {
        seen[index] = route;
      });
      return null;
    };

    const view = await renderIntoDocument(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(Subscriber, { index: 0 }),
        React.createElement(Subscriber, { index: 1 }),
        React.createElement(Subscriber, { index: 2 }),
      ),
    );

    const hashAdds = addSpy.mock.calls.filter(
      ([type]) => String(type) === "hashchange",
    );
    expect(hashAdds).toHaveLength(1);
    expect(seen[0]).toEqual({ kind: "wallet" });
    expect(seen[1]).toBe(seen[0]);
    expect(seen[2]).toBe(seen[0]);

    await act(async () => {
      window.location.hash = "#settings";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });

    expect(seen[0]).toEqual({ kind: "settings" });
    expect(seen[1]).toBe(seen[0]);
    expect(seen[2]).toBe(seen[0]);

    await view.unmount();

    const hashRemoves = removeSpy.mock.calls.filter(
      ([type]) => String(type) === "hashchange",
    );
    expect(hashRemoves).toHaveLength(1);
  });
});
