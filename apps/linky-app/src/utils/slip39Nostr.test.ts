import {
  deriveNostrSecretKeyFromMasterSecret,
  recoverMasterSecretFromSlip39Share,
} from "@linky-fit/identity";
import { describe, expect, it, vi } from "vitest";
import {
  deriveCashuBip85MnemonicFromSlip39,
  deriveEvoluOwnerMnemonicFromSlip39,
  deriveNostrKeysFromSlip39,
  forgetRecoveredMasterSecret,
} from "./slip39Nostr";

vi.mock("@linky-fit/identity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@linky-fit/identity")>();
  return {
    ...actual,
    recoverMasterSecretFromSlip39Share: vi.fn(
      actual.recoverMasterSecretFromSlip39Share,
    ),
    deriveNostrSecretKeyFromMasterSecret: vi.fn(
      actual.deriveNostrSecretKeyFromMasterSecret,
    ),
  };
});

// The cross-app vector share from packages/identity.
const SHARE =
  "item lilac academic academic armed dress review premium imply typical dominant daisy voting random agency bike dive being coastal rocky";
const OTHER_SHARE =
  "duckling enlarge academic academic agency result length solution fridge kidney coal piece deal husband erode duke ajar critical decision keyboard";

const deriveAll = (share: string) =>
  Promise.all([
    deriveNostrKeysFromSlip39(share),
    deriveEvoluOwnerMnemonicFromSlip39(share, "meta", 0),
    deriveCashuBip85MnemonicFromSlip39(share),
  ]);

describe("slip39Nostr", () => {
  it("recovers the master secret and the Nostr key once per share", async () => {
    const [keys, appMnemonic, cashuMnemonic] = await deriveAll(SHARE);
    await deriveAll(SHARE);

    expect(keys?.nsec).toBe(
      "nsec13lzw09lv9pd6zqtfxykleu8ny8hh0ux37r7qedcghz82m7mmwqjsaj430k",
    );
    expect(appMnemonic).toBe(
      "diet swift world sand heart donate squeeze never inner glove ability exist",
    );
    expect(cashuMnemonic).toBe(
      "welcome trigger where when inflict token ready resist humble lift alert peanut cook place virus field banana smile oven hobby tail chair manage easily",
    );
    expect(keys?.npub).toBe(
      "npub1emlla45qgkxa0n6yj243m0uygv6332atrxckg7z5c4226lg3ke2qxdfpgk",
    );
    expect(recoverMasterSecretFromSlip39Share).toHaveBeenCalledTimes(1);
    expect(deriveNostrSecretKeyFromMasterSecret).toHaveBeenCalledTimes(1);

    const [otherKeys] = await deriveAll(OTHER_SHARE);
    expect(otherKeys?.nsec).not.toBe(keys?.nsec);
    expect(recoverMasterSecretFromSlip39Share).toHaveBeenCalledTimes(2);

    forgetRecoveredMasterSecret();
    await deriveAll(OTHER_SHARE);
    expect(recoverMasterSecretFromSlip39Share).toHaveBeenCalledTimes(3);
  });

  it("returns null for text that is not a share", async () => {
    expect(await deriveAll("not a share")).toEqual([null, null, null]);
  });
});
