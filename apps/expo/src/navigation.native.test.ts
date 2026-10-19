import { describe, expect, it, mock } from "bun:test";
import { encodeNpub } from "@linky-fit/linkstr";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import { subscribeAddContactHashLinks } from "@linky-fit/linky-app/src/platform/hashLinks.native";

// The native modules navigation.native.tsx loads cannot run under Bun.
void mock.module("react-native", () => ({
  Linking: { addEventListener: () => ({ remove: () => {} }) },
}));
void mock.module("@linky-fit/linky-app/src/platform/restartApp.native", () => ({
  restartAppAt: () => {},
}));
void mock.module("expo-router", () => ({
  ExpoRoot: () => null,
  Slot: () => null,
  router: { replace: () => {} },
  useGlobalSearchParams: () => ({}),
  usePathname: () => "/",
}));
void mock.module("expo-router/_ctx", () => ({ ctx: {} }));

const { redirectSystemPath } = await import("./navigation.native");

const npub = encodeNpub(makeIdentity().pubkey);
const addedNpubs: string[] = [];
subscribeAddContactHashLinks((link) => addedNpubs.push(link));

describe("redirectSystemPath", () => {
  it("opens the launch link as the first route", () => {
    expect(
      redirectSystemPath({ path: "linky://contacts", initial: true }),
    ).toBe("/contacts");
  });

  it.each(["linky://contacts", `linky://#add/${npub}`])(
    "keeps the router from pushing %s while the app runs",
    (path) => {
      expect(redirectSystemPath({ path, initial: false })).toBeNull();
    },
  );

  it("still hands a link that arrives while the app runs to its subscribers", () => {
    addedNpubs.length = 0;
    redirectSystemPath({ path: `linky://#add/${npub}`, initial: false });
    expect(addedNpubs).toEqual([npub]);
  });
});
