import type {
  AmountLike,
  Keyset,
  OutputConfig,
  OutputDataLike,
  Proof,
  ProofLike,
  ProofState,
  SendConfig,
  SendResponse,
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

/** A key chain listing `keysets`, each already holding its keys. */
export const fakeKeyChain = (
  keysets: ReadonlyArray<Keyset> = [],
): LoadedWallet["keyChain"] => ({
  getKeysets: () => [...keysets],
  ensureKeysetKeys: (id) => {
    const keyset = keysets.find((listed) => listed.id === id);
    return keyset === undefined
      ? Promise.reject(new Error(`Keyset '${id}' not found`))
      : Promise.resolve(keyset);
  },
});

/** One whole spend swap, the shape of cashu-ts's own `send`. */
export type FakeSwap = (
  amount: AmountLike,
  proofs: ProofLike[],
  config?: SendConfig,
  outputConfig?: OutputConfig,
) => Promise<SendResponse>;

/** Output amounts a prepared swap plans in its send and keep blocks. */
export interface SwapPlan {
  readonly send: ReadonlyArray<number>;
  readonly keep: ReadonlyArray<number>;
}

export type FakeWalletOverrides = Partial<LoadedWallet> & {
  /** Answers the prepared swap unless `prepareSwapToSend` is overridden. */
  readonly send?: FakeSwap;
  /** What each prepared swap plans; nothing by default. */
  readonly swapPlan?: SwapPlan;
};

/**
 * Splits `send` into the prepare and complete calls a spend makes. The
 * preview spends every offered proof; other previews go to `completeOther`.
 */
const preparedSwaps = (
  send: FakeSwap,
  plan: SwapPlan,
  completeOther: LoadedWallet["completeSwap"],
): Pick<LoadedWallet, "prepareSwapToSend" | "completeSwap"> => {
  const requests = new WeakMap<SwapPreview, Parameters<FakeSwap>>();
  return {
    prepareSwapToSend: (...request) => {
      const preview: SwapPreview = {
        amount: CashuAmount.from(0),
        fees: CashuAmount.from(0),
        keysetId: KEYSET_HEX,
        inputs: request[1].map((input) => ({
          ...input,
          amount: CashuAmount.from(input.amount),
        })),
        sendOutputs: plan.send.map(plannedOutput),
        keepOutputs: plan.keep.map(plannedOutput),
      };
      requests.set(preview, request);
      return Promise.resolve(preview);
    },
    completeSwap: (preview, privkey) => {
      const request = requests.get(preview);
      return request === undefined
        ? completeOther(preview, privkey)
        : send(...request);
    },
  };
};

/** A wallet whose every call fails; tests override only what they exercise. */
export const fakeWallet = ({
  send,
  swapPlan = { send: [], keep: [] },
  ...overrides
}: FakeWalletOverrides = {}): LoadedWallet => {
  const wallet = baseWallet(overrides);
  return send === undefined || overrides.prepareSwapToSend !== undefined
    ? wallet
    : { ...wallet, ...preparedSwaps(send, swapPlan, wallet.completeSwap) };
};

const baseWallet = (overrides: Partial<LoadedWallet>): LoadedWallet => ({
  keysetId: KEYSET_HEX,
  keyChain: fakeKeyChain(),
  getMintInfo: () => fakeMintInfo(),
  loadMint: notUnderTest,
  prepareSwapToReceive: notUnderTest,
  completeSwap: notUnderTest,
  prepareSwapToSend: notUnderTest,
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

/** An output a preview plans; only its amount is read. */
export const plannedOutput = (amount: number): OutputDataLike => ({
  blindedMessage: { amount: CashuAmount.from(amount), id: KEYSET_HEX, B_: "" },
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
        keepOutputs: Array.from({ length: outputs }, () => plannedOutput(1)),
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
