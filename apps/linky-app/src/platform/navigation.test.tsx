import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import {
  currentRoutePath,
  navigateToRoutePath,
  useCurrentRoutePath,
} from "./navigation";

const setUrl = (url: string) => window.history.replaceState(null, "", url);

const renderRoutePath = async () => {
  const seen: string[] = [];
  const Probe = () => {
    seen.push(useCurrentRoutePath());
    return null;
  };
  await renderIntoDocument(<Probe />);
  return seen;
};

const hashChanged = () =>
  new Promise<void>((resolve) =>
    window.addEventListener("hashchange", () => resolve(), { once: true }),
  );

afterEach(() => setUrl("/"));

describe("currentRoutePath", () => {
  it("reads the hash without its #, query included", () => {
    setUrl("/?ref=x#wallet/recurring/new?contact=c1");

    expect(currentRoutePath()).toBe("wallet/recurring/new?contact=c1");
  });

  it("is empty without a hash", () => {
    expect(currentRoutePath()).toBe("");
  });

  it("opens contacts for an empty hash, with or without a query", () => {
    setUrl("/#");
    expect(currentRoutePath()).toBe("contacts");

    setUrl("/#?notificationOpen=x");
    expect(currentRoutePath()).toBe("contacts?notificationOpen=x");
  });
});

describe("navigateToRoutePath", () => {
  it("adds a history entry and fires hashchange", async () => {
    const length = window.history.length;
    const changed = hashChanged();

    navigateToRoutePath("chat/abc");
    await changed;

    expect(window.location.hash).toBe("#chat/abc");
    expect(window.history.length).toBe(length + 1);
  });

  it("replaces the entry in place, keeping path and search", async () => {
    setUrl("/app?ref=x#add/npub1x");
    const seen = await renderRoutePath();
    const length = window.history.length;

    act(() => navigateToRoutePath("contacts", { replace: true }));

    expect(window.location.pathname).toBe("/app");
    expect(window.location.search).toBe("?ref=x");
    expect(window.location.hash).toBe("#contacts");
    expect(window.history.length).toBe(length);
    expect(seen.at(-1)).toBe("contacts");
  });
});

describe("useCurrentRoutePath", () => {
  it("follows a hash changed from outside the app", async () => {
    const seen = await renderRoutePath();
    const changed = hashChanged();

    window.location.hash = "#settings";
    await act(() => changed);

    expect(seen.at(-1)).toBe("settings");
  });
});
