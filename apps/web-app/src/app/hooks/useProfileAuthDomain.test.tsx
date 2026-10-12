import { encodeNsec, ProfileMetadata } from "@linky-fit/linkstr";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import { AtomRegistry, RegistryContext } from "@linky-fit/linkstr-react";
import { Exit } from "effect";
import { AsyncResult, type Atom } from "effect/reactivity";
import { act, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../../testUtils/renderIntoDocument";
import type { IdentitySwitchCheck } from "../lib/keySwitchProfile";
import { myProfileMetadataAtom } from "../state/contacts/profiles";
import { messagesCommandsAtom } from "../state/messages/commands";
import { useProfileAuthDomain } from "./useProfileAuthDomain";

const currentNsec = encodeNsec(makeIdentity().secretKey);
const pastedNsec = encodeNsec(makeIdentity().secretKey);

const mocks = vi.hoisted(() => ({
  checkIdentityForSwitch: vi.fn(),
  derivedNsec: "",
  identitySource: "derived",
  ownerMnemonic: ((): string | null => null)(),
  pushToast: vi.fn(),
  persistIdentitySecrets: vi.fn(),
  publishProfile: vi.fn(),
  readClipboardText: vi.fn(),
  writeStoredAttachedNsec: vi.fn(),
  calls: new Array<string>(),
  atomValues: new Map<unknown, unknown>(),
}));

vi.mock("@linky-fit/linkstr-react", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@linky-fit/linkstr-react")>();
  return {
    ...actual,
    useAtomSet: () => vi.fn(),
    useAtomValue: <A,>(atom: Atom.Atom<A>) =>
      mocks.atomValues.has(atom)
        ? mocks.atomValues.get(atom)
        : actual.useAtomValue(atom),
    useLinkstrCommands: () => ({
      fetchProfile: vi.fn(),
      publishProfile: mocks.publishProfile,
      publishStatus: vi.fn(),
    }),
  };
});

vi.mock("../lib/keySwitchProfile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/keySwitchProfile")>()),
  checkIdentityForSwitch: mocks.checkIdentityForSwitch,
}));

vi.mock("../../evolu", () => ({}));

vi.mock("../../platform/clipboard", () => ({
  readClipboardText: mocks.readClipboardText,
}));

vi.mock("../lib/beaconStore", () => ({
  stopBeaconForIdentityChange: () => mocks.calls.push("stopBeacon"),
}));

vi.mock("../../platform/logoutWipe", () => ({
  markLogoutPending: () => mocks.calls.push("markLogoutPending"),
}));

vi.mock("../../platform/identitySecrets", () => ({
  clearIdentitySecrets: async () => {
    mocks.calls.push("clearIdentitySecrets");
  },
  persistIdentitySecrets: mocks.persistIdentitySecrets,
  readStoredAttachedNsec: async () => null,
  readStoredCashuMnemonic: async () => "cashu mnemonic",
  readStoredSlip39Seed: async () => "slip39 seed",
  removeStoredAttachedNsec: vi.fn(),
  writeStoredAttachedNsec: mocks.writeStoredAttachedNsec,
  writeStoredCashuMnemonic: vi.fn(),
}));

vi.mock("../../utils/slip39Nostr", () => ({
  createSlip39Seed: vi.fn(),
  deriveCashuBip85MnemonicFromSlip39: async () => "cashu mnemonic",
  deriveEvoluOwnerMnemonicFromSlip39: async () => mocks.ownerMnemonic,
  deriveNostrKeysFromSlip39: async () => ({
    npub: "npub1derived",
    nsec: mocks.derivedNsec,
  }),
}));

vi.mock("../../utils/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/storage")>()),
  getInitialNostrIdentitySource: () => mocks.identitySource,
}));

type AuthDomain = ReturnType<typeof useProfileAuthDomain>;

const deferredCheck = () => {
  let resolve!: (check: IdentitySwitchCheck) => void;
  mocks.checkIdentityForSwitch.mockReturnValue(
    new Promise<IdentitySwitchCheck>((settle) => {
      resolve = settle;
    }),
  );
  return resolve;
};

let unmount: (() => Promise<void>) | undefined;
afterEach(async () => {
  await unmount?.();
  vi.unstubAllGlobals();
});

const setup = async () => {
  const domain: { current: AuthDomain | null } = { current: null };
  const Probe = () => {
    const value = useProfileAuthDomain({
      currentNsec,
      identityRepository: null,
      inboxCursors: null,
      lang: "en",
      pushToast: vi.fn(),
      t: (key) => key,
    });
    useEffect(() => {
      domain.current = value;
    }, [value]);
    return null;
  };
  ({ unmount } = await renderIntoDocument(
    <RegistryContext.Provider value={AtomRegistry.make()}>
      <Probe />
    </RegistryContext.Provider>,
  ));
  return domain;
};

describe("logging out", () => {
  it("stops the beacon before anything else, so the signed-out app never advertises", async () => {
    mocks.calls.length = 0;
    vi.stubGlobal("location", { reload: () => mocks.calls.push("reload") });
    const domain = await setup();
    const confirm = () =>
      act(async () => domain.current?.requestLogout({ evoluConnected: true }));

    await confirm();
    expect(mocks.calls).toEqual([]);
    await confirm();
    expect(mocks.calls).toEqual([
      "stopBeacon",
      "clearIdentitySecrets",
      "markLogoutPending",
      "reload",
    ]);
  });
});

describe("switching to a custom identity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The seed derives the current identity, so no derived switch starts.
    mocks.derivedNsec = currentNsec;
    mocks.identitySource = "derived";
    mocks.ownerMnemonic = null;
    mocks.readClipboardText.mockResolvedValue(pastedNsec);
    mocks.atomValues.set(
      myProfileMetadataAtom,
      new ProfileMetadata({ name: "Alice" }),
    );
    mocks.atomValues.set(messagesCommandsAtom, AsyncResult.initial());
  });

  it("shows the check while it runs and leaves the identity alone when cancelled", async () => {
    const resolveCheck = deferredCheck();
    const domain = await setup();

    let request: Promise<void> | undefined;
    await act(async () => {
      request = domain.current?.requestPasteNostrKeys();
    });
    expect(domain.current?.pendingIdentitySwitch?.phase).toBe("checking");

    await act(async () => domain.current?.answerPendingIdentitySwitch(null));
    expect(domain.current?.pendingIdentitySwitch).toBeNull();

    await act(async () => {
      resolveCheck({
        check: { kind: "none" },
        lightningAddress: "bob@linky.fit",
      });
      await request;
    });
    expect(domain.current?.pendingIdentitySwitch).toBeNull();
    expect(mocks.publishProfile).not.toHaveBeenCalled();
    expect(mocks.persistIdentitySecrets).not.toHaveBeenCalled();
  });

  it("offers the choice once the check finds a profile", async () => {
    const resolveCheck = deferredCheck();
    const domain = await setup();

    let request: Promise<void> | undefined;
    await act(async () => {
      request = domain.current?.requestPasteNostrKeys();
    });
    await act(async () => {
      resolveCheck({
        check: {
          kind: "found",
          metadata: new ProfileMetadata({ name: "Bob" }),
        },
        lightningAddress: "bob@linky.fit",
      });
      await request;
    });

    expect(domain.current?.pendingIdentitySwitch).toMatchObject({
      phase: "choosing",
      check: { kind: "found" },
      lightningAddress: "bob@linky.fit",
    });
    expect(mocks.publishProfile).not.toHaveBeenCalled();
  });

  it("switches back to the derived identity with its own profile, without asking", async () => {
    mocks.derivedNsec = pastedNsec;
    mocks.identitySource = "custom";
    mocks.ownerMnemonic =
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    mocks.publishProfile.mockResolvedValue(Exit.succeed(undefined));
    const resolveCheck = deferredCheck();
    const domain = await setup();
    await act(async () => {});

    let request: Promise<void> | undefined;
    await act(async () => {
      request = domain.current?.switchToDefaultIdentity();
    });
    await act(async () => {
      resolveCheck({
        check: {
          kind: "found",
          metadata: new ProfileMetadata({ name: "Alice before" }),
        },
        lightningAddress: "alice@linky.fit",
      });
      await request;
    });

    expect(mocks.pushToast).not.toHaveBeenCalled();
    expect(domain.current?.pendingIdentitySwitch).toBeNull();
    expect(mocks.publishProfile).toHaveBeenCalledOnce();
    expect(mocks.publishProfile.mock.calls[0]?.[0]).toMatchObject({
      name: "Alice before",
    });
    // The custom identity stays attached to the device.
    expect(mocks.writeStoredAttachedNsec).toHaveBeenCalledWith(currentNsec);
    expect(mocks.persistIdentitySecrets).toHaveBeenCalledWith(
      expect.objectContaining({ identitySource: "derived", nsec: pastedNsec }),
    );
  });

  it("asks for the profile when switching back cannot check the derived identity's", async () => {
    mocks.derivedNsec = pastedNsec;
    mocks.identitySource = "custom";
    mocks.ownerMnemonic =
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    const resolveCheck = deferredCheck();
    const domain = await setup();
    await act(async () => {});

    let request: Promise<void> | undefined;
    await act(async () => {
      request = domain.current?.switchToDefaultIdentity();
    });
    await act(async () => {
      resolveCheck({
        check: { kind: "unchecked" },
        lightningAddress: "alice@linky.fit",
      });
      await request;
    });

    expect(domain.current?.pendingIdentitySwitch).toMatchObject({
      phase: "choosing",
      check: { kind: "unchecked" },
    });
    expect(mocks.publishProfile).not.toHaveBeenCalled();
    expect(mocks.persistIdentitySecrets).not.toHaveBeenCalled();
  });

  it("offers the default identity only while a custom one is active", async () => {
    const onDefault = await setup();
    expect(onDefault.current?.canSwitchToDefaultIdentity).toBe(false);
    await unmount?.();

    mocks.derivedNsec = pastedNsec;
    mocks.identitySource = "custom";
    const onCustom = await setup();
    await act(async () => {});
    expect(onCustom.current?.canSwitchToDefaultIdentity).toBe(true);
  });
});
