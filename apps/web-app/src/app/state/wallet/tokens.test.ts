// @vitest-environment jsdom
import { createIdFromString } from "@linky-fit/linksync";
import {
  Amount,
  CurrencyUnit,
  InsufficientFunds,
  InvalidTransferTransition,
  IssuedClaimReport,
  MintUrl,
  NonNegativeAmount,
  OperationId,
  OperationNotFound,
  ProofId,
  ReclaimReport,
  RestoreReport,
  SendReceipt,
  TokenText,
  TransferCheckResult,
  ValidationReport,
  TokenTransfer,
  type RestoreProgress,
} from "@linky-fit/linkshu";
import {
  ClientId,
  EnqueueReceipt,
  OutboxJobId,
  PaymentNoticeReceipt,
  RelayUrl,
  RumorId,
  UnixSeconds,
  WrapDelivery,
  WrapId,
} from "@linky-fit/linkstr";
import { Exit, Result, Schema } from "effect";
import { getPublicKey, nip19 } from "nostr-tools";
import { describe, expect, it, vi } from "vitest";
import { buildCashuToken } from "../../../testUtils/cashuToken";
import { createSecretKey } from "../../../testUtils/nostrKeys";
import { walletBalancesOf } from "../../../testUtils/walletFakes";
import { MAIN_MINT_URL } from "../../../utils/mint";
import { NO_WRITE } from "../../lib/storeWrite";
import type { CashuTransferLifecycle } from "../linkshu/commands";
import { makeWalletOps } from "./opQueue";
import {
  makeTokensCommands,
  restoreCandidates,
  type TokensDeps,
} from "./tokens";

const MINT_URL = "https://mint.example";
const sentAt = UnixSeconds.make(1_730_000_000);
const contactNpub = nip19.npubEncode(getPublicKey(createSecretKey(2)));
const CONTACT_ID = createIdFromString<"Contact">("contact");
const tokenText = buildCashuToken({ amounts: [21], mint: MINT_URL });

const reclaimReport = (
  fields: Partial<ConstructorParameters<typeof ReclaimReport>[0]> = {},
) =>
  new ReclaimReport({
    reclaimedAmount: NonNegativeAmount.make(12),
    reclaimedProofs: [ProofId.make("p1")],
    spentProofs: [],
    unresolvedProofs: [],
    ...fields,
  });

const restoreReport = (
  fields: Partial<ConstructorParameters<typeof RestoreReport>[0]> = {},
) =>
  new RestoreReport({
    restoredAmount: NonNegativeAmount.make(0),
    restoredProofs: 0,
    scannedMints: [],
    unavailableMints: [],
    ...fields,
  });

const sendReceipt = new SendReceipt({
  operationId: OperationId.make("issued-op"),
  tokenText: TokenText.make(tokenText),
  proofs: [],
  mint: MintUrl.make(MINT_URL),
  unit: CurrencyUnit.make("sat"),
  amount: Amount.make(21),
  lockTo: null,
  changeAmount: NonNegativeAmount.make(0),
  feePaid: NonNegativeAmount.make(0),
});

const issuedTransfer = Schema.decodeUnknownSync(TokenTransfer)({
  id: "issued-op",
  kind: "send",
  status: "issued",
  tokenText,
  amount: 21,
  mint: MINT_URL,
  unit: "sat",
  error: null,
  createdAt: 1,
});

const lifecycleFake = (
  overrides: Partial<CashuTransferLifecycle> = {},
): CashuTransferLifecycle => ({
  reclaim: vi.fn(async () => reclaimReport()),
  checkIssuedClaims: vi.fn(async () => new IssuedClaimReport({ claimed: [] })),
  forget: vi.fn(async () => Result.succeed(undefined)),
  importLegacyRows: vi.fn(),
  importOperation: vi.fn(),
  importProofs: vi.fn(),
  markExternalized: vi.fn(async () => Result.succeed(undefined)),
  markIssued: vi.fn(async () => Result.succeed(undefined)),
  returnToWallet: vi.fn(),
  ...overrides,
});

const setup = ({
  balances = { [MINT_URL]: 100 },
  lifecycle = lifecycleFake(),
  online = true,
  linkshu = {},
  deferUpdateWhile,
}: {
  balances?: Record<string, number>;
  lifecycle?: CashuTransferLifecycle;
  online?: boolean;
  linkshu?: Partial<TokensDeps["linkshu"]>;
  deferUpdateWhile?: (work: Promise<void>) => void;
} = {}) => {
  const ops = makeWalletOps(() => {}, deferUpdateWhile);
  const deps = {
    cashuTransferLifecycle: lifecycle,
    checkAllCashuTokens: vi.fn(
      async () =>
        new ValidationReport({
          checkedProofs: 1,
          markedSpent: [],
          unavailableMints: [],
        }),
    ),
    checkCashuTransfer: vi.fn<TokensDeps["linkshu"]["checkCashuTransfer"]>(),
    readWalletBalances: vi.fn(async () => walletBalancesOf(balances)),
    reclaimCashuTokens: vi.fn<TokensDeps["linkshu"]["reclaimCashuTokens"]>(
      async () => ({ restore: null, reclaim: reclaimReport() }),
    ),
    restoreCashuTokens: vi.fn<TokensDeps["linkshu"]["restoreCashuTokens"]>(
      async () => ({ restore: restoreReport(), reclaim: reclaimReport() }),
    ),
    sendCashuToken: vi.fn<TokensDeps["linkshu"]["sendCashuToken"]>(async () =>
      Result.succeed(sendReceipt),
    ),
    ...linkshu,
  };
  const linkstr = {
    enqueueOutbox: vi.fn<TokensDeps["linkstr"]["enqueueOutbox"]>(
      async (input) =>
        Exit.succeed(
          new EnqueueReceipt({
            jobId: OutboxJobId.make("job-1"),
            ref: input.ref,
            rumorId: RumorId.make("12".repeat(32)),
            clientId: input.op.draft.clientId ?? ClientId.make("client"),
            sentAt,
          }),
        ),
    ),
    sendPaymentNotice: vi.fn<TokensDeps["linkstr"]["sendPaymentNotice"]>(
      async (draft) =>
        Exit.succeed(
          new PaymentNoticeReceipt({
            rumorId: RumorId.make("34".repeat(32)),
            clientId: draft.clientId ?? ClientId.make("notice"),
            sentAt,
            recipientCopy: new WrapDelivery({
              wrapId: WrapId.make("cc".repeat(32)),
              acceptedBy: [RelayUrl.make("wss://relay.example")],
              rejectedBy: [],
            }),
          }),
        ),
    ),
  };
  const logPaymentEvent = vi.fn<TokensDeps["logPaymentEvent"]>();
  const commands = makeTokensCommands({
    allowTestMints: true,
    defaultMint: MINT_URL,
    currentNsec: nip19.nsecEncode(createSecretKey(1)),
    isOnline: () => online,
    linkshu: deps,
    linkstr,
    logPaymentEvent,
    ops,
  });
  return { commands, linkshu: deps, linkstr, logPaymentEvent, ops };
};

const holdWallet = (ops: ReturnType<typeof makeWalletOps>) => {
  let release = () => {};
  const held = ops.runQueuedTask(
    () => new Promise<void>((resolve) => (release = resolve)),
  );
  return () => {
    release();
    return held;
  };
};

describe("restoreCandidates", () => {
  it("scans every known mint plus the production mint", () => {
    expect(
      restoreCandidates({
        allowTestMints: true,
        defaultMint: null,
        isMintDeleted: () => false,
        knownMints: ["https://mint-a.example", "https://mint-b.example/", ""],
      }),
    ).toEqual([
      "https://mint-a.example",
      "https://mint-b.example",
      MintUrl.make(MAIN_MINT_URL),
    ]);
  });

  it("skips deleted mints but never the production or default mint", () => {
    expect(
      restoreCandidates({
        allowTestMints: true,
        defaultMint: "https://kashu.me",
        isMintDeleted: () => true,
        knownMints: ["https://mint-a.example", "https://kashu.me"],
      }),
    ).toEqual(["https://kashu.me", MintUrl.make(MAIN_MINT_URL)]);
  });
});

describe("recoverTokens", () => {
  const mints = [MintUrl.make("https://mint-a.example")];

  it("restores with progress, checks the envelopes and records reclaimed funds", async () => {
    const update: RestoreProgress = {
      phase: "scanning",
      completedKeysets: 2,
      totalKeysets: 5,
      totalMints: 1,
    };
    const restored = setup({
      linkshu: {
        restoreCashuTokens: async (_mints, onProgress) => {
          onProgress?.(update);
          return { restore: restoreReport(), reclaim: reclaimReport() };
        },
      },
    });
    const onProgress = vi.fn();
    const recoverEnvelopes = vi.fn(async () => {});
    const onStarted = vi.fn();

    const outcome = await restored.commands.recoverTokens(
      { mode: "missing", mints, onProgress, recoverEnvelopes },
      { onStarted },
    );

    expect(outcome).toMatchObject({ _tag: "Restored", incomplete: false });
    expect(onProgress).toHaveBeenCalledWith(update);
    expect(onStarted).toHaveBeenCalledOnce();
    expect(recoverEnvelopes).toHaveBeenCalledOnce();
    expect(restored.logPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ method: "cashu_restore", amount: 12 }),
    );
  });

  it("reports a restore incomplete when a mint could not be scanned", async () => {
    const { commands } = setup({
      linkshu: {
        restoreCashuTokens: async () => ({
          restore: restoreReport({
            unavailableMints: [MintUrl.make(MAIN_MINT_URL)],
          }),
          reclaim: reclaimReport({
            reclaimedAmount: NonNegativeAmount.make(0),
          }),
        }),
      },
    });

    expect(
      await commands.recoverTokens({
        mode: "missing",
        mints,
        onProgress: () => {},
        recoverEnvelopes: async () => {},
      }),
    ).toMatchObject({ _tag: "Restored", incomplete: true });
  });

  it("reclaims without scanning, and scans the given mints for the full recovery", async () => {
    const { commands, linkshu } = setup();
    const recoverEnvelopes = vi.fn(async () => {});

    expect(
      await commands.recoverTokens({
        mode: "reclaim",
        mints,
        onProgress: () => {},
        recoverEnvelopes,
      }),
    ).toMatchObject({ _tag: "Reclaimed", incomplete: false });
    expect(linkshu.reclaimCashuTokens).toHaveBeenLastCalledWith(undefined);
    expect(recoverEnvelopes).not.toHaveBeenCalled();

    await commands.recoverTokens({
      mode: "all",
      mints,
      onProgress: () => {},
      recoverEnvelopes,
    });
    expect(linkshu.reclaimCashuTokens).toHaveBeenLastCalledWith(mints);
    expect(recoverEnvelopes).toHaveBeenCalledOnce();
    expect(linkshu.restoreCashuTokens).not.toHaveBeenCalled();
  });

  it("has nothing to scan without mints and fails with the restore's error", async () => {
    const { commands } = setup({
      linkshu: {
        restoreCashuTokens: async () => {
          throw new Error("recovery interrupted");
        },
      },
    });
    const run = (scan: typeof mints) =>
      commands.recoverTokens({
        mode: "missing",
        mints: scan,
        onProgress: () => {},
        recoverEnvelopes: async () => {},
      });

    expect(await run([])).toEqual({ _tag: "NothingToScan" });
    expect(await run(mints)).toEqual({
      _tag: "Failed",
      detail: "Error: recovery interrupted",
    });
  });
});

describe("issueToken", () => {
  it("issues a claim-watched token from the planned mint and records it", async () => {
    const { commands, linkshu, logPaymentEvent } = setup();
    const onStarted = vi.fn();

    expect(
      await commands.issueToken({ amountSat: 21, memo: "tip" }, { onStarted }),
    ).toEqual({ _tag: "Issued", receipt: sendReceipt });
    expect(onStarted).toHaveBeenCalledOnce();
    expect(linkshu.sendCashuToken).toHaveBeenCalledWith({
      amountSat: 21,
      memo: "tip",
      mint: MINT_URL,
      produceAs: "issued",
    });
    expect(logPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ note: "tip", phase: "swap", status: "ok" }),
    );
  });

  it("is insufficient when no mint covers it, or when the send says so", async () => {
    expect(
      await setup({ balances: { [MINT_URL]: 5 } }).commands.issueToken({
        amountSat: 21,
        memo: null,
      }),
    ).toEqual({ _tag: "Insufficient" });

    const short = setup({
      linkshu: {
        sendCashuToken: async () =>
          Result.fail(
            new InsufficientFunds({
              mint: MintUrl.make(MINT_URL),
              required: Amount.make(21),
              available: NonNegativeAmount.make(5),
            }),
          ),
      },
    });
    expect(
      await short.commands.issueToken({ amountSat: 21, memo: null }),
    ).toMatchObject({ _tag: "Failed", insufficient: true });
    expect(short.logPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error", phase: "swap" }),
    );
  });

  it("is dropped while another wallet operation runs", async () => {
    const { commands, ops } = setup();
    const release = holdWallet(ops);
    expect(await commands.issueToken({ amountSat: 21, memo: null })).toEqual({
      _tag: "Busy",
    });
    await release();
  });
});

describe("checks", () => {
  it.each([
    ["live", "Live"],
    ["spent", "Spent"],
    ["unavailable", "Unavailable"],
  ] as const)("maps a %s transfer to %s", async (status, tag) => {
    const { commands } = setup({
      linkshu: {
        checkCashuTransfer: async (operationId) =>
          Result.succeed(
            new TransferCheckResult({
              operationId: OperationId.make(operationId),
              status,
            }),
          ),
      },
    });
    expect(await commands.checkToken("op")).toEqual({ _tag: tag });
  });

  it("does not know an unknown transfer and drops a check while the wallet is busy", async () => {
    const { commands, ops } = setup({
      linkshu: {
        checkCashuTransfer: async (operationId) =>
          Result.fail(
            new OperationNotFound({
              operationId: OperationId.make(operationId),
            }),
          ),
      },
    });
    expect(await commands.checkToken("op")).toEqual({ _tag: "Unknown" });
    const release = holdWallet(ops);
    expect(await commands.checkToken("op")).toEqual({ _tag: "Busy" });
    expect(await commands.checkAllTokens()).toEqual({ _tag: "Busy" });
    await release();
  });

  it("shares one issued-claims check between concurrent callers", async () => {
    const lifecycle = lifecycleFake();
    const { commands } = setup({ lifecycle });

    const [first, second] = await Promise.all([
      commands.checkIssuedClaims(),
      commands.checkIssuedClaims(),
    ]);

    expect(first).toBe(second);
    expect(lifecycle.checkIssuedClaims).toHaveBeenCalledOnce();
  });
});

describe("transfer updates", () => {
  it("tells a transition the transfer no longer allows from other failures", async () => {
    const operationId = OperationId.make("op");
    const { commands } = setup({
      lifecycle: lifecycleFake({
        forget: vi.fn(async () =>
          Result.fail(
            new InvalidTransferTransition({
              operationId,
              from: "pending",
              to: "done",
            }),
          ),
        ),
        markIssued: vi.fn(async () =>
          Result.fail(new OperationNotFound({ operationId })),
        ),
      }),
    });

    expect(await commands.forget("op")).toMatchObject({
      _tag: "InvalidTransition",
    });
    expect(await commands.markIssued("op")).toMatchObject({ _tag: "Failed" });
    expect(await commands.markExternalized("op")).toEqual({ _tag: "Done" });
  });

  it("reclaims a transfer through the queue and reports a failure as text", async () => {
    const lifecycle = lifecycleFake({
      reclaim: vi
        .fn<CashuTransferLifecycle["reclaim"]>()
        .mockResolvedValueOnce(reclaimReport())
        .mockRejectedValueOnce(new Error("mint down")),
    });
    const { commands } = setup({ lifecycle });

    expect(await commands.reclaimTransfer("op")).toEqual({
      _tag: "Reclaimed",
      report: reclaimReport(),
    });
    expect(await commands.reclaimTransfer("op")).toEqual({
      _tag: "Failed",
      detail: "mint down",
    });
  });

  it("holds back an app update until a reclaim settles", async () => {
    let finishReclaim = () => {};
    const lifecycle = lifecycleFake({
      reclaim: () =>
        new Promise((resolve) => {
          finishReclaim = () => resolve(reclaimReport());
        }),
    });
    const held: Promise<void>[] = [];
    const { commands } = setup({
      lifecycle,
      deferUpdateWhile: (work) => held.push(work),
    });
    let released = false;

    const reclaiming = commands.reclaimTransfer("op");
    void Promise.all(held).then(() => {
      released = true;
    });
    await new Promise((resolve) => setTimeout(resolve));

    expect(held).toHaveLength(1);
    expect(released).toBe(false);
    finishReclaim();
    await reclaiming;
    await Promise.all(held);
    expect(released).toBe(true);
  });
});

describe("sendIssuedToken", () => {
  const transfer = issuedTransfer;
  const contact = { id: CONTACT_ID, npub: contactNpub };
  const chat = () => ({
    appendLocalNostrMessage: vi.fn(() => ({ id: "row-1", written: NO_WRITE })),
    updateLocalNostrMessage: vi.fn(() => NO_WRITE),
  });

  it("closes the transfer, sends the token message and its notice, then records it", async () => {
    const order: string[] = [];
    const lifecycle = lifecycleFake({
      forget: vi.fn(async () => {
        order.push("forget");
        return Result.succeed(undefined);
      }),
    });
    const { commands, linkstr, logPaymentEvent } = setup({ lifecycle });
    linkstr.enqueueOutbox.mockImplementationOnce(async (input) => {
      order.push("enqueue");
      return Exit.succeed(
        new EnqueueReceipt({
          jobId: OutboxJobId.make("job-1"),
          ref: input.ref,
          rumorId: RumorId.make("12".repeat(32)),
          clientId: input.op.draft.clientId ?? ClientId.make("client"),
          sentAt,
        }),
      );
    });
    const writes = chat();

    const outcome = await commands.sendIssuedToken(
      { transfer, contact, onClosed: () => order.push("closed") },
      writes,
    );

    expect(outcome).toEqual({ _tag: "Sent" });
    expect(order).toEqual(["forget", "closed", "enqueue"]);
    expect(writes.updateLocalNostrMessage).toHaveBeenCalledWith(
      "row-1",
      expect.objectContaining({ createdAtSec: sentAt }),
    );
    expect(linkstr.sendPaymentNotice).toHaveBeenCalledOnce();
    expect(logPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ phase: "complete", paymentType: "contact" }),
    );
  });

  it("queues the message offline without a notice", async () => {
    const { commands, linkstr, logPaymentEvent } = setup({ online: false });

    expect(
      await commands.sendIssuedToken({ transfer, contact }, chat()),
    ).toEqual({ _tag: "Queued" });
    expect(linkstr.sendPaymentNotice).not.toHaveBeenCalled();
    expect(logPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ phase: "publish" }),
    );
  });

  it("sends nothing while the transfer stays open", async () => {
    const { commands, linkstr } = setup({
      lifecycle: lifecycleFake({
        forget: vi.fn(async () =>
          Result.fail(
            new OperationNotFound({ operationId: OperationId.make("x") }),
          ),
        ),
      }),
    });

    expect(
      await commands.sendIssuedToken({ transfer, contact }, chat()),
    ).toMatchObject({ _tag: "NotClosed" });
    expect(linkstr.enqueueOutbox).not.toHaveBeenCalled();
  });

  it("refuses a missing token or a contact without an npub", async () => {
    const { commands } = setup();
    expect(
      await commands.sendIssuedToken({ transfer: null, contact }, chat()),
    ).toEqual({ _tag: "InvalidToken" });
    expect(
      await commands.sendIssuedToken(
        { transfer, contact: { id: CONTACT_ID, npub: "" } },
        chat(),
      ),
    ).toEqual({ _tag: "MissingContactNpub" });
  });
});
