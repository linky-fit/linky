import { encodeNpub, encodeNsec } from "@linky-fit/linkstr";
import { bytesToHex } from "@noble/hashes/utils.js";
import { Effect, Layer } from "effect";
import { describe, expect, test } from "vitest";
import {
  deriveCashuMnemonicFromMasterSecret,
  deriveOwnerMnemonicsFromMasterSecret,
} from "./derive";
import { Slip39Passphrase } from "./domain";
import { IdentityProvider } from "./IdentityProvider";
import { deriveLnurlAuthPublicKeyHex } from "./lnurlAuth";
import { MasterSecretProvider } from "./MasterSecretProvider";
import { parseSlip39Share, recoverMasterSecretFromSlip39Share } from "./slip39";

/**
 * Every output derived from a share, pinned from the implementation that
 * shipped before derivation moved to WebCrypto PBKDF2. A change here breaks
 * every existing account.
 */
interface DerivationVector {
  readonly share: string;
  readonly passphrase: string;
  readonly masterSecret: string;
  readonly nsec: string;
  readonly npub: string;
  readonly appMnemonic: string;
  readonly cashuMnemonic: string;
  readonly cashuWalletSeed: string;
  readonly ownerMnemonics: {
    readonly identity: string;
    readonly errorTracker: string;
    readonly contacts: string;
    readonly cashu: string;
    readonly transactions: string;
    readonly messages: string;
  };
  readonly lnurlAuthPublicKey: string;
}

const OFFICIAL_SHARE =
  "duckling enlarge academic academic agency result length solution fridge kidney coal piece deal husband erode duke ajar critical decision keyboard";

const VECTORS: Record<string, DerivationVector> = {
  "cross-app share": {
    share:
      "item lilac academic academic armed dress review premium imply typical dominant daisy voting random agency bike dive being coastal rocky",
    passphrase: "",
    masterSecret: "000102030405060708090a0b0c0d0e0f",
    nsec: "nsec13lzw09lv9pd6zqtfxykleu8ny8hh0ux37r7qedcghz82m7mmwqjsaj430k",
    npub: "npub1emlla45qgkxa0n6yj243m0uygv6332atrxckg7z5c4226lg3ke2qxdfpgk",
    appMnemonic:
      "diet swift world sand heart donate squeeze never inner glove ability exist",
    cashuMnemonic:
      "welcome trigger where when inflict token ready resist humble lift alert peanut cook place virus field banana smile oven hobby tail chair manage easily",
    cashuWalletSeed:
      "650b25127a8e53204e5da804137f545a0cb1fa4497e5833b67768817b6aa50e6d34c28db7a47f79ba0582e3c009535a247f3cc953b37850683738197a1710f29",
    ownerMnemonics: {
      identity:
        "license ball recipe unusual strike knock clarify wise paddle learn ladder rack",
      errorTracker:
        "tenant need that canoe stereo worth chase bus fragile ripple tennis meat",
      contacts:
        "milk material jacket kite brand bubble enlist steel trend electric banner oyster",
      cashu:
        "plug glow ivory track rookie biology round muscle define injury pen engine",
      transactions:
        "patient edit uncle pudding hamster rare nature park capital board together bench",
      messages:
        "cactus rigid hard foil vacant wave tobacco tongue twelve atom cigar chase",
    },
    lnurlAuthPublicKey:
      "023f6e95b4b09b3f85cd37caa78e3424d539986770ed3a96bfc0917cd1e2a43c8d",
  },
  // SLIP-0039 test vector 1, "Valid mnemonic without sharing (128 bits)".
  "SLIP-0039 vector 1": {
    share: OFFICIAL_SHARE,
    passphrase: "TREZOR",
    masterSecret: "bb54aac4b89dc868ba37d9cc21b2cece",
    nsec: "nsec18czwfdfnjz58k933nttwetr0ju7wfxglnd608guallwq37506xdsyhm6mk",
    npub: "npub1emx2ts2nls698ukhwcy604ae6hpu396j2kn2he7x9652wcpegzcsmvkdzk",
    appMnemonic:
      "machine describe invite enlist rally call scissors wing burst vault tornado pause",
    cashuMnemonic:
      "admit pole include grant attend sample truth empty aunt lyrics okay whisper outside capital innocent carpet around news void clay brand length truth ozone",
    cashuWalletSeed:
      "4321e8870da7d8ba469a7a0dd72bc769c40bbbc6348380e4bd4415ebf029db599e5e1c3c30392652d9b5d1dd996ef64d4c6c63cbc2ff5ad7fe4d5f9826d110ae",
    ownerMnemonics: {
      identity:
        "blast remain ethics hello gun proud forget shop ocean leave connect remain",
      errorTracker:
        "purpose high spy meadow switch water door diamond cross proof object found",
      contacts:
        "bicycle blanket evidence maid height double unique claw dance voice bid tomato",
      cashu:
        "skin crawl bracket sea bonus arctic annual vacuum spare letter mom teach",
      transactions:
        "scrub custom you find fresh possible effort time time abandon slender twin",
      messages:
        "crash romance emerge where return blue chair defense heavy love alert token",
    },
    lnurlAuthPublicKey:
      "021cd569a8f437b06fe3c4c4f524b3196ce05be2529b9cbd762daaf32883d043b3",
  },
  "SLIP-0039 vector 1 with the empty passphrase Linky uses": {
    share: OFFICIAL_SHARE,
    passphrase: "",
    masterSecret: "3972a9318cf16a33ee9b0564c5a0bd0b",
    nsec: "nsec1lfwrelas5h7zeuzjuk923993dyguh3jumsnyynlnv9tugnfvfw4qnr3k94",
    npub: "npub1ldv48d9tkvj7xhmcgzukvqqrx8wkkc4r9rz5tzv50e9vjuls6tjs0x8ft5",
    appMnemonic:
      "brisk mail enact opinion word fiber heavy proud bachelor raise skull risk",
    cashuMnemonic:
      "ozone fever honey slim play use leg such lesson deposit giggle above monkey humor kiss sadness liquid ranch spare south basic little roast stem",
    cashuWalletSeed:
      "4ecb2927455919abef18d4c31e007dacac8946ef63c4b8650279fe8d5177348720f1f43e9b645d25228edee0771b0e737c540f3658f62626329a860135d3f023",
    ownerMnemonics: {
      identity:
        "chair glue lake usual praise gentle vault mountain circle hour dust require",
      errorTracker:
        "black elite sell disease similar nuclear guilt slab all minimum wedding trip",
      contacts:
        "awful pass check october resemble make oven wish agree goose animal absent",
      cashu:
        "sting pill sponsor above diagram hidden capital custom minimum number artist diesel",
      transactions:
        "embark obvious margin elder have logic arrive liar glass diamond general broken",
      messages:
        "bubble page price labor square frame coconut carbon medal pair below embody",
    },
    lnurlAuthPublicKey:
      "03484e9aea6928d4dcacdc207a0bf63695735eaaea4c71eeb83e58fee2a1fde87f",
  },
  // SLIP-0039 test vector "Valid extendable mnemonic without sharing (128 bits)".
  "SLIP-0039 extendable vector": {
    share:
      "testify swimming academic academic column loyalty smear include exotic bedroom exotic wrist lobe cover grief golden smart junior estimate learn",
    passphrase: "TREZOR",
    masterSecret: "1679b4516e0ee5954351d288a838f45e",
    nsec: "nsec1zprh70eu6spgxgwc44qu7pw2n9x90hs2h2gzs88tc8lcnq7ttxns3q8e03",
    npub: "npub1yqrcj7msh8cjtwaehw8qa8q6rxm8vvhvm9dau9j85wt27v3ddnpswned2f",
    appMnemonic:
      "cost grief vendor sausage method thing fantasy report fruit remain robust silent",
    cashuMnemonic:
      "lake company sunny cereal believe art spice voice tool tornado fetch route visit canyon enjoy bar exist plate van manual dial feel debate ribbon",
    cashuWalletSeed:
      "484da4deeee476f4da394820cef20a77ae490c3e4d7b061783d957352473006c948e4875042fe7d1ea3a6a8be9287753a66a47af9531df10e0ae9df8eaf2c1dd",
    ownerMnemonics: {
      identity:
        "short police skin camera real exile shoot exclude cute weather resist myth",
      errorTracker:
        "sport electric clarify bullet rifle depth forward random tuition tragic inner churn",
      contacts:
        "beauty describe favorite over reunion guide horn hover retire penalty argue shy",
      cashu:
        "fancy develop burden elder throw depend plastic case shove follow cherry melt",
      transactions:
        "bullet fruit dance special move excess dilemma pigeon good head umbrella ridge",
      messages:
        "accident consider shoulder walnut safe about post brain since dad spike antenna",
    },
    lnurlAuthPublicKey:
      "039387a7a6ce86e37a8df03eb1e251139ba1906a429357cfe07d36142eb62bc21a",
  },
};

const deriveEverything = async ({
  share: raw,
  passphrase,
}: DerivationVector) => {
  const share = await Effect.runPromise(parseSlip39Share(raw));
  const pass = Slip39Passphrase.make(passphrase);
  const masterSecret = await Effect.runPromise(
    recoverMasterSecretFromSlip39Share(share, pass),
  );
  const identity = await Effect.runPromise(
    Effect.provide(
      IdentityProvider,
      Layer.provideMerge(
        IdentityProvider.layer,
        MasterSecretProvider.fromSlip39Share(share, pass),
      ),
    ),
  );
  const [meta, ...owners] = await Effect.runPromise(
    deriveOwnerMnemonicsFromMasterSecret(masterSecret, [
      { role: "meta" },
      { role: "identity" },
      { role: "errorTracker" },
      { role: "contacts" },
      { role: "cashu" },
      { role: "transactions" },
      { role: "messages" },
    ]),
  );
  const [identityOwner, errorTracker, contacts, cashu, transactions, messages] =
    owners;
  return {
    share: raw,
    passphrase,
    masterSecret: bytesToHex(masterSecret),
    nsec: encodeNsec(identity.nostrSigningKey),
    npub: encodeNpub(identity.nostrPublicKey),
    appMnemonic: meta,
    cashuMnemonic: await Effect.runPromise(
      deriveCashuMnemonicFromMasterSecret(masterSecret),
    ),
    cashuWalletSeed: bytesToHex(identity.cashuWalletSeed),
    ownerMnemonics: {
      identity: identityOwner,
      errorTracker,
      contacts,
      cashu,
      transactions,
      messages,
    },
    lnurlAuthPublicKey: deriveLnurlAuthPublicKeyHex(
      identity.nostrSigningKey,
      "example.com",
    ),
  };
};

describe("derivation vectors", () => {
  test.each(Object.entries(VECTORS))(
    "%s derives its pinned outputs",
    async (_name, vector) => {
      expect(await deriveEverything(vector)).toEqual(vector);
    },
  );
});
