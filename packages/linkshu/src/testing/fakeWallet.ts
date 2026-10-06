import type {
  Keyset,
  OutputDataLike,
  Proof,
  ProofLike,
  ProofState,
  SwapPreview,
} from "@cashu/cashu-ts";
import { Amount as CashuAmount, MintInfo } from "@cashu/cashu-ts";
import type { LoadedWallet } from "../mint/internal/WalletInstances";

export const KEYSET_HEX = "009a1f293253e41e";

export const proof = (amount: number, secret: string): Proof => ({
  id: KEYSET_HEX,
  amount: CashuAmount.from(amount),
  secret,
  C: "02" + "ab".repeat(32),
});

const notUnderTest = () => Promise.reject(new Error("not under test"));

/** Published info of a mint that advertises NUT-07 proof state checks. */
export const fakeMintInfo = (stateCheck = true): MintInfo =>
  new MintInfo({
    name: "Fake mint",
    pubkey: "02" + "ab".repeat(32),
    version: "Nutshell/0.16.0",
    contact: [],
    nuts: {
      "4": { methods: [], disabled: false },
      "5": { methods: [], disabled: false },
      "7": { supported: stateCheck },
    },
  });

/** A key chain listing `keysets` that fetches no keys. */
export const fakeKeyChain = (
  keysets: ReadonlyArray<Keyset> = [],
): LoadedWallet["keyChain"] => ({
  getKeysets: () => [...keysets],
  ensureKeysetKeys: notUnderTest,
});

/** A wallet whose every call fails; tests override only what they exercise. */
export const fakeWallet = (
  overrides: Partial<LoadedWallet> = {},
): LoadedWallet => ({
  keysetId: KEYSET_HEX,
  keyChain: fakeKeyChain(),
  getMintInfo: () => fakeMintInfo(),
  loadMint: notUnderTest,
  prepareSwapToReceive: notUnderTest,
  completeSwap: notUnderTest,
  send: notUnderTest,
  selectProofsToSend: () => {
    throw new Error("not under test");
  },
  checkProofsStates: notUnderTest,
  mint: {
    webSocketConnection: { onClose: () => undefined },
    disconnectWebSocket: () => undefined,
    restore: notUnderTest,
  },
  on: { mintQuoteUpdates: notUnderTest },
  createMintQuoteBolt11: notUnderTest,
  createLockedMintQuote: notUnderTest,
  checkMintQuoteBolt11: notUnderTest,
  mintProofsBolt11: notUnderTest,
  createMeltQuoteBolt11: notUnderTest,
  checkMeltQuoteBolt11: notUnderTest,
  meltProofsBolt11: notUnderTest,
  restore: notUnderTest,
  batchRestore: notUnderTest,
  ...overrides,
});

export type ProofStateName = ProofState["state"];

/** A NUT-07 answer naming `stateOf(secret)` for every proof asked about. */
export const answerProofStates =
  (stateOf: (secret: string) => ProofStateName = () => "UNSPENT") =>
  (proofs: Array<Pick<ProofLike, "secret" | "id">>): Promise<ProofState[]> =>
    Promise.resolve(
      proofs.map((entry) => ({
        Y: entry.secret ?? "",
        state: stateOf(entry.secret ?? ""),
        witness: null,
      })),
    );

const placeholderOutput = (): OutputDataLike => ({
  blindedMessage: { amount: CashuAmount.from(1), id: KEYSET_HEX, B_: "" },
  blindingFactor: 0n,
  secret: new Uint8Array(),
  toProof: () => {
    throw new Error("not under test");
  },
});

/**
 * The receive swap of a fake wallet: each preview reserves `outputs` slots,
 * and completing it answers with `sign(token, counter)`.
 */
export const fakeReceiveSwap = (
  sign: (token: string, counter: number) => Promise<Proof[]>,
  outputs = 2,
): Pick<LoadedWallet, "prepareSwapToReceive" | "completeSwap"> => {
  const requests = new WeakMap<
    SwapPreview,
    { readonly token: string; readonly counter: number }
  >();
  return {
    prepareSwapToReceive: (token, _config, outputType) => {
      const preview: SwapPreview = {
        amount: CashuAmount.from(0),
        fees: CashuAmount.from(0),
        keysetId: KEYSET_HEX,
        inputs: [],
        keepOutputs: Array.from({ length: outputs }, placeholderOutput),
      };
      requests.set(preview, {
        token,
        counter: outputType?.type === "deterministic" ? outputType.counter : -1,
      });
      return Promise.resolve(preview);
    },
    completeSwap: (preview) => {
      const request = requests.get(preview);
      return request === undefined
        ? notUnderTest()
        : sign(request.token, request.counter).then((keep) => ({
            keep,
            send: [],
          }));
    },
  };
};
