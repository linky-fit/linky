import { encodeNsec, ProfileMetadata } from "@linky-fit/linkstr";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import { act, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../../testUtils/renderIntoDocument";
import type { IdentitySwitchCheck } from "../lib/keySwitchProfile";
import { useProfileAuthDomain } from "./useProfileAuthDomain";

const currentNsec = encodeNsec(makeIdentity().secretKey);
const pastedNsec = encodeNsec(makeIdentity().secretKey);

const mocks = vi.hoisted(() => ({
  checkIdentityForSwitch: vi.fn(),
  derivedNsec: "",
  identitySource: "derived",
  persistIdentitySecrets: vi.fn(),
  publishProfile: vi.fn(),
  readClipboardText: vi.fn(),
}));

vi.mock("@linky-fit/linkstr-react", () => {
  const publishProfileAtom = {};
  return {
    fetchProfileAtom: {},
    linkstrConfigAtom: {},
    publishProfileAtom,
    publishStatusAtom: {},
    useAtomSet: (atom: unknown) =>
      atom === publishProfileAtom ? mocks.publishProfile : vi.fn(),
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

vi.mock("../../platform/identitySecrets", () => ({
  clearIdentitySecrets: vi.fn(),
  persistIdentitySecrets: mocks.persistIdentitySecrets,
  readStoredCashuMnemonic: async () => "cashu mnemonic",
  readStoredSlip39Seed: async () => "slip39 seed",
  writeStoredCashuMnemonic: vi.fn(),
}));

vi.mock("../../utils/slip39Nostr", () => ({
  createSlip39Seed: vi.fn(),
  deriveCashuBip85MnemonicFromSlip39: async () => "cashu mnemonic",
  deriveEvoluOwnerMnemonicFromSlip39: async () => null,
  deriveNostrKeysFromSlip39: async () => ({ nsec: mocks.derivedNsec }),
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

describe("switching to a custom identity", () => {
  let unmount: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await unmount?.();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // The seed derives the current identity, so no derived switch starts.
    mocks.derivedNsec = currentNsec;
    mocks.identitySource = "derived";
    mocks.readClipboardText.mockResolvedValue(pastedNsec);
  });

  const setup = async () => {
    const domain: { current: AuthDomain | null } = { current: null };
    const Probe = () => {
      const value = useProfileAuthDomain({
        appendIdentityChangeNoticesRef: { current: null },
        currentNsec,
        identityRepository: null,
        inboxCursors: null,
        lang: "en",
        myProfileMetadataRef: {
          current: new ProfileMetadata({ name: "Alice" }),
        },
        pushToast: vi.fn(),
        t: (key) => key,
      });
      useEffect(() => {
        domain.current = value;
      }, [value]);
      return null;
    };
    ({ unmount } = await renderIntoDocument(<Probe />));
    return domain;
  };

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
