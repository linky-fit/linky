// @vitest-environment jsdom
import { encodeNpub, encodeNsec } from "@linky-fit/linkstr";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import { Effect } from "effect";
import { AtomRegistry } from "effect/reactivity";
import { describe, expect, it, vi } from "vitest";
import {
  makeTestAppRegistry,
  signedInSession,
} from "../../../testUtils/appRegistry";
import { makeTestLinkyStore } from "../../../testUtils/linkyStore";
import { currentNpubAtom } from "./session";
import { appOwnerIdAtom } from "./store";

vi.mock("@evolu/common", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@evolu/common")>()),
  createEvolu: () => () => ({}),
}));
const openLinkyStore = vi.hoisted(() => vi.fn());
vi.mock("@linky-fit/linksync/evolu", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@linky-fit/linksync/evolu")>()),
  openLinkyStore,
}));

describe("session identity atoms", () => {
  it("derives the npub from the session's nsec", () => {
    const identity = makeIdentity();
    const registry = makeTestAppRegistry({
      session: signedInSession({ nsec: encodeNsec(identity.secretKey) }),
    });
    expect(registry.get(currentNpubAtom)).toBe(encodeNpub(identity.pubkey));
  });

  it("has no npub while signed out", () => {
    const registry = makeTestAppRegistry({ session: { _tag: "SignedOut" } });
    expect(registry.get(currentNpubAtom)).toBeNull();
  });

  it("reads the app owner id from the session's store", async () => {
    const { appOwner, store } = makeTestLinkyStore();
    openLinkyStore.mockResolvedValue(store);
    const registry = makeTestAppRegistry();
    await expect(
      Effect.runPromise(AtomRegistry.getResult(registry, appOwnerIdAtom)),
    ).resolves.toBe(appOwner.id);
  });
});
