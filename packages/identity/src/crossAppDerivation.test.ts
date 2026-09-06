import { hmac } from "@noble/hashes/hmac.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { HDKey } from "@scure/bip32";
import { entropyToMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { Effect, Layer, Schema } from "effect";
import { Slip39 } from "slip39-ts";
import { describe, expect, test } from "vitest";
import { IdentityProvider } from "./IdentityProvider";
import { MasterSecretProvider } from "./MasterSecretProvider";
import { OwnerLaneIndex, type OwnerRole } from "./domain";
import { encodeNpub, encodeNsec } from "@linky/linkstr";
import { deriveOwnerMnemonicsFromMasterSecret } from "./derive";
import { parseSlip39Share, recoverMasterSecretFromSlip39Share } from "./slip39";

/**
 * Cross-app seed and key derivation vectors shared between Linky and Payky.
 *
 * The identical vector table lives in both repos:
 *   linky: packages/identity/src/crossAppDerivation.test.ts
 *   payky: src/core/modules/shared/cross-app-derivation.test.ts
 *
 * Both apps derive everything from a 16-byte master secret carried by a
 * 20-word SLIP-39 share (empty passphrase) via BIP-32 plus BIP-85-style
 * entropy (HMAC-SHA512 keyed "bip-entropy-from-k" over the derived node's
 * private key). A user's share must recover the same master secret in both
 * apps, and the shared cashu path must yield the same wallet.
 *
 * If a change here is intentional, update BOTH copies in the same way —
 * a mismatch means one app broke seed compatibility with the other.
 */
const MASTER_SECRET_HEX = "000102030405060708090a0b0c0d0e0f";
const SLIP39_SHARE =
  "item lilac academic academic armed dress review premium imply typical dominant daisy voting random agency bike dive being coastal rocky";

const NOSTR_VECTOR = {
  path: "m/44'/1237'/0'/0/0",
  privateKeyHex:
    "8fc4e797ec285ba10169312dfcf0f321ef77f0d1f0fc0cb708b88eadfb7b7025",
};

interface Bip85Vector {
  readonly path: string;
  readonly entropyBytes: 16 | 32;
  readonly entropyHex: string;
  readonly mnemonic?: string;
}

const BIP85_VECTORS: Record<string, Bip85Vector> = {
  sharedCashuWallet: {
    path: "m/83696968'/39'/0'/24'/0'",
    entropyBytes: 32,
    entropyHex:
      "f95d13e97d1737c7ecb5bb6ef02c18d0f2fb4bbd22af12399677362dd44ba1ba",
    mnemonic:
      "welcome trigger where when inflict token ready resist humble lift alert peanut cook place virus field banana smile oven hobby tail chair manage easily",
  },
  linkyMetaOwner: {
    path: "m/83696968'/39'/0'/24'/1'/0'",
    entropyBytes: 16,
    entropyHex: "3dbb7bf6df96a48234e4a8746c7400a7",
    mnemonic:
      "diet swift world sand heart donate squeeze never inner glove ability exist",
  },
  linkyContactsOwner0: {
    path: "m/83696968'/39'/0'/24'/2'/0'",
    entropyBytes: 16,
    entropyHex: "8c911ddc3d91b03a92b6a9e808ec494f",
    mnemonic:
      "milk material jacket kite brand bubble enlist steel trend electric banner oyster",
  },
  linkyContactsOwner1: {
    path: "m/83696968'/39'/0'/24'/2'/1'",
    entropyBytes: 16,
    entropyHex: "7f6d342c3ece8f341e9867e33b9504cf",
    mnemonic:
      "legal have arch laugh trophy old kidney artefact tobacco syrup donkey palace",
  },
  linkyCashuOwner0: {
    path: "m/83696968'/39'/0'/24'/3'/0'",
    entropyBytes: 16,
    entropyHex: "a6cc79dbf34bbc2cef1c8c398e8689a5",
    mnemonic:
      "plug glow ivory track rookie biology round muscle define injury pen engine",
  },
  linkyCashuOwner1: {
    path: "m/83696968'/39'/0'/24'/3'/1'",
    entropyBytes: 16,
    entropyHex: "b69981c9b80febf6125bc7a285327673",
    mnemonic:
      "repair slot include hybrid wrong wild enact jump penalty civil outside travel",
  },
  linkyMessagesOwner0: {
    path: "m/83696968'/39'/0'/24'/4'/0'",
    entropyBytes: 16,
    entropyHex: "20173da4ad3f07eff8cf23eb01c8a393",
    mnemonic:
      "cactus rigid hard foil vacant wave tobacco tongue twelve atom cigar chase",
  },
  linkyMessagesOwner1: {
    path: "m/83696968'/39'/0'/24'/4'/1'",
    entropyBytes: 16,
    entropyHex: "df6a9d56250629b57c98faaf7844c5f6",
    mnemonic:
      "term female few energy glad survey venue butter quarter season cousin undo",
  },
  linkyTransactionsOwner0: {
    path: "m/83696968'/39'/0'/24'/5'/0'",
    entropyBytes: 16,
    entropyHex: "a108cfb256968b6424dd022203178e8a",
    mnemonic:
      "patient edit uncle pudding hamster rare nature park capital board together bench",
  },
  linkyTransactionsOwner1: {
    path: "m/83696968'/39'/0'/24'/5'/1'",
    entropyBytes: 16,
    entropyHex: "43d4e0d9ec58c93686745ca21492d139",
    mnemonic:
      "duck poem cushion suffer milk opera border merit pear pig reform indicate",
  },
  linkyIdentityOwner: {
    path: "m/83696968'/39'/0'/24'/6'/0'",
    entropyBytes: 16,
    entropyHex: "81223ecef72d70f78a7fe39ecfd9f1d8",
    mnemonic:
      "license ball recipe unusual strike knock clarify wise paddle learn ladder rack",
  },
  paykyEvoluOwner: {
    path: "m/83696968'/39'/0'/24'/1'",
    entropyBytes: 32,
    entropyHex:
      "752f4f00e250861b5bd7c79077eb20cae8a18bb3c8cb7f54be5c6a1de8e48b0c",
  },
  paykySparkWallet: {
    path: "m/83696968'/39'/0'/12'/0'",
    entropyBytes: 16,
    entropyHex: "a8117f2ba9ed92d57c35e5997ecf9ca8",
    mnemonic:
      "pool message slab fatigue summer height valid royal offer wait transfer expand",
  },
};

const BIP85_HMAC_KEY = new TextEncoder().encode("bip-entropy-from-k");

const deriveEntropy = (path: string, entropyBytes: 16 | 32): string => {
  const root = HDKey.fromMasterSeed(hexToBytes(MASTER_SECRET_HEX));
  const privateKey = root.derive(path).privateKey;
  if (!privateKey) throw new Error(`no private key at ${path}`);
  return bytesToHex(
    hmac(sha512, BIP85_HMAC_KEY, privateKey).slice(0, entropyBytes),
  );
};

describe("cross-app derivation vectors (shared with Payky)", () => {
  test("the SLIP-39 share recovers the master secret with an empty passphrase", async () => {
    expect(Slip39.validateMnemonic(SLIP39_SHARE)).toBe(true);
    const recovered = new Uint8Array(
      await Slip39.recoverSecret([SLIP39_SHARE], ""),
    );
    expect(bytesToHex(recovered)).toBe(MASTER_SECRET_HEX);
  });

  test("the nostr signing key derives from the master secret via plain BIP-32", () => {
    const root = HDKey.fromMasterSeed(hexToBytes(MASTER_SECRET_HEX));
    const privateKey = root.derive(NOSTR_VECTOR.path).privateKey;
    expect(privateKey && bytesToHex(privateKey)).toBe(
      NOSTR_VECTOR.privateKeyHex,
    );
  });

  test.each(Object.entries(BIP85_VECTORS))(
    "path %s yields its pinned BIP-85 entropy and mnemonic",
    (_name, vector) => {
      expect(deriveEntropy(vector.path, vector.entropyBytes)).toBe(
        vector.entropyHex,
      );
      if (vector.mnemonic !== undefined) {
        expect(entropyToMnemonic(hexToBytes(vector.entropyHex), wordlist)).toBe(
          vector.mnemonic,
        );
      }
    },
  );
});

// ── Linky-specific binding: the public @linky/identity API must land on
// the shared vectors above. Payky's copy binds its own key-derivation API here.

const lane = (index: number): OwnerLaneIndex =>
  Schema.decodeUnknownSync(OwnerLaneIndex)(index);

const hex = (u8: Uint8Array): string => bytesToHex(u8);

describe("@linky/identity API matches the cross-app vectors", () => {
  const loadIdentity = async () => {
    const share = await Effect.runPromise(parseSlip39Share(SLIP39_SHARE));
    const masterSecret = await Effect.runPromise(
      recoverMasterSecretFromSlip39Share(share),
    );
    const identity = await Effect.runPromise(
      Effect.provide(
        IdentityProvider,
        Layer.provideMerge(
          IdentityProvider.Live,
          MasterSecretProvider.fromSlip39Share(share),
        ),
      ),
    );
    return { identity, masterSecret };
  };

  test("recovers the shared master secret from the share", async () => {
    const { masterSecret } = await loadIdentity();
    expect(hex(masterSecret)).toBe(MASTER_SECRET_HEX);
  });

  test("derives the pinned nostr identity", async () => {
    const { identity } = await loadIdentity();
    expect(hex(identity.nostrSigningKey)).toBe(NOSTR_VECTOR.privateKeyHex);
    expect(encodeNsec(identity.nostrSigningKey)).toBe(
      "nsec13lzw09lv9pd6zqtfxykleu8ny8hh0ux37r7qedcghz82m7mmwqjsaj430k",
    );
    expect(encodeNpub(identity.nostrPublicKey)).toBe(
      "npub1emlla45qgkxa0n6yj243m0uygv6332atrxckg7z5c4226lg3ke2qxdfpgk",
    );
  });

  test("derives the cashu wallet seed from the shared cashu mnemonic", async () => {
    const { identity } = await loadIdentity();
    const vector = BIP85_VECTORS.sharedCashuWallet;
    expect(vector?.mnemonic).toBeDefined();
    if (!vector?.mnemonic) return;
    expect(hex(identity.cashuWalletSeed)).toBe(
      bytesToHex(mnemonicToSeedSync(vector.mnemonic)),
    );
  });

  test("derives every owner lane key from its pinned vector", async () => {
    const { identity } = await loadIdentity();
    const ownerKeys: Record<string, Uint8Array> = {
      linkyMetaOwner: identity.storageMetaOwnerKey,
      linkyIdentityOwner: identity.storageIdentityOwnerKey,
      linkyContactsOwner0: identity.storageContactsOwnerKey(lane(0)),
      linkyContactsOwner1: identity.storageContactsOwnerKey(lane(1)),
      linkyCashuOwner0: identity.storageCashuOwnerKey(lane(0)),
      linkyCashuOwner1: identity.storageCashuOwnerKey(lane(1)),
      linkyMessagesOwner0: identity.storageMessagesOwnerKey(lane(0)),
      linkyMessagesOwner1: identity.storageMessagesOwnerKey(lane(1)),
      linkyTransactionsOwner0: identity.storageTransactionsOwnerKey(lane(0)),
      linkyTransactionsOwner1: identity.storageTransactionsOwnerKey(lane(1)),
    };
    for (const [name, ownerKey] of Object.entries(ownerKeys)) {
      expect(`${name}:${hex(ownerKey)}`).toBe(
        `${name}:${BIP85_VECTORS[name]?.entropyHex}`,
      );
    }
  });

  test("derives every owner lane mnemonic from its pinned vector", async () => {
    const { masterSecret } = await loadIdentity();
    const roleLanes: ReadonlyArray<
      readonly [string, OwnerRole, OwnerLaneIndex]
    > = [
      ["linkyMetaOwner", "meta", lane(0)],
      ["linkyIdentityOwner", "identity", lane(0)],
      ["linkyContactsOwner0", "contacts", lane(0)],
      ["linkyContactsOwner1", "contacts", lane(1)],
      ["linkyCashuOwner0", "cashu", lane(0)],
      ["linkyCashuOwner1", "cashu", lane(1)],
      ["linkyMessagesOwner0", "messages", lane(0)],
      ["linkyMessagesOwner1", "messages", lane(1)],
      ["linkyTransactionsOwner0", "transactions", lane(0)],
      ["linkyTransactionsOwner1", "transactions", lane(1)],
    ];
    for (const [name, role, index] of roleLanes) {
      const [mnemonic] = await Effect.runPromise(
        deriveOwnerMnemonicsFromMasterSecret(masterSecret, [{ role, index }]),
      );
      expect(`${name}:${mnemonic}`).toBe(
        `${name}:${BIP85_VECTORS[name]?.mnemonic}`,
      );
    }
  });
});
