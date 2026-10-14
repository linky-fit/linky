import {
  DecodedToken,
  encodeToken,
  MintUrl,
  TokenTransfer,
} from "@linky-fit/linkshu";
import {
  ClientId,
  encodeNpub,
  EnqueueReceipt,
  makeRelayPoolTransport,
  NostrTransport,
  OutboxJobFailed,
  OutboxJobId,
  OutboxRef,
  RelayUrl,
  RumorId,
  UnixSeconds,
  type Pubkey,
} from "@linky-fit/linkstr";
import { FakeRelay, makeIdentity, poolFor } from "@linky-fit/linkstr/testing";
import { Layer, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import type { WithdrawTarget } from "../domain";
import type { Ledger } from "../storage/ledger";
import { createNostr } from "./nostr";
import { makeLinkstrRuntime } from "./runtimes";
import {
  fakeNostr,
  setup,
  sharedOutboxStore,
  testMint as mint,
} from "./testing/fakes";
import type { Wallet } from "./wallet";
import { createWithdrawals } from "./withdrawals";

const relay = RelayUrl.make("wss://relay.test");
const recipient = makeIdentity().pubkey;
const toLinky: WithdrawTarget = {
  kind: "cashu_chat",
  pubkey: recipient,
  npub: encodeNpub(recipient),
};

const tokenOf = (amount: number) =>
  encodeToken(
    Schema.decodeUnknownSync(DecodedToken)({
      mint,
      unit: "sat",
      memo: null,
      proofs: [
        {
          id: "00ad268c4d1f5826",
          amount,
          secret: `secret-${amount}`,
          C: "02".padEnd(66, "a"),
        },
      ],
    }),
  );

const pendingSend = (id: string, amount: number) =>
  Schema.decodeUnknownSync(TokenTransfer)({
    id,
    kind: "send",
    status: "pending",
    tokenText: tokenOf(amount),
    mint,
    unit: "sat",
    amount,
    error: null,
    createdAt: 1_700_000_000,
  });

const enqueued = (ref: string) =>
  new EnqueueReceipt({
    jobId: OutboxJobId.make(ref),
    ref: OutboxRef.make(ref),
    rumorId: RumorId.make("ef".repeat(32)),
    clientId: ClientId.make(ref),
    sentAt: UnixSeconds.make(1_700_000_000),
  });

/** A pending Linky withdrawal of 100 sat, linked to the send `operationId` when given. */
const linkyWithdrawal = async (ledger: Ledger, operationId?: string) => {
  const created = await ledger.createWithdrawal({
    kind: "cashu_chat",
    target: encodeNpub(recipient),
    amountSats: 100,
    feeSats: null,
    mintUrl: mint,
  });
  return operationId === undefined
    ? created
    : ledger.updateWithdrawal(created, { operationId });
};

/** A wallet of `sats` at the local mint in `proofs` proofs, at 100 ppk. */
const walletHolding = (
  wallet: Wallet,
  sats: number,
  proofs: number,
): Wallet => ({
  ...wallet,
  richestMint: async () =>
    sats > 0 ? { mint: MintUrl.make(mint), sats } : null,
  inputFeePpk: async () => 100,
  availableProofCount: async () => proofs,
});

describe("quoting a withdrawal to Linky", () => {
  const quote = (
    sats: number,
    proofs: number,
    options?: { amountSats?: number },
  ) => {
    const { ledger, wallet } = setup();
    return createWithdrawals({
      ledger,
      nostr: fakeNostr().nostr,
      wallet: walletHolding(wallet, sats, proofs),
    }).quote(toLinky, options);
  };

  it("sends the whole balance with the fee of spending every proof deducted", async () => {
    expect(await quote(1_000, 15)).toEqual(
      Result.succeed(
        expect.objectContaining({
          amountSats: 998,
          feeSats: 2,
          totalSats: 1_000,
          wholeBalance: true,
        }),
      ),
    );
  });

  it("prices a chosen amount and refuses one the fee does not fit next to", async () => {
    expect(await quote(1_000, 15, { amountSats: 500 })).toEqual(
      Result.succeed(
        expect.objectContaining({
          amountSats: 500,
          totalSats: 502,
          wholeBalance: false,
        }),
      ),
    );
    expect(await quote(1_000, 15, { amountSats: 999 })).toEqual(
      Result.fail("insufficient-funds"),
    );
  });

  it("refuses an empty wallet and a balance the fee eats", async () => {
    expect(await quote(0, 0)).toEqual(Result.fail("insufficient-funds"));
    expect(await quote(1, 1)).toEqual(Result.fail("amount-too-small"));
  });
});

describe("Linky withdrawals over the outbox", () => {
  const onFakeRelay = (outboxStore = sharedOutboxStore()) => {
    const { account, ...rest } = setup();
    const runtime = makeLinkstrRuntime({
      secretKey: account.secretKey,
      relays: [relay],
      allowInsecureLocalhostRelays: false,
      transport: Layer.succeed(
        NostrTransport,
        makeRelayPoolTransport(poolFor(new Map([[relay, new FakeRelay()]]))),
      ),
      outboxStore,
    });
    const nostr = createNostr({
      runtime,
      pubkey: account.pubkey,
      relays: [relay],
      outboxStore,
    });
    return { ...rest, nostr, runtime };
  };

  it("closes a withdrawal once a relay took its token", async () => {
    const { ledger, wallet, nostr, runtime } = onFakeRelay();
    const forgotten: string[] = [];
    createWithdrawals({
      ledger,
      nostr,
      wallet: {
        ...wallet,
        forgetSend: async (operationId) => void forgotten.push(operationId),
      },
    });
    const withdrawal = await linkyWithdrawal(ledger, "send-1");
    nostr.start();
    await nostr.sendToken(
      recipient,
      tokenOf(100),
      `fazole.withdrawal:${withdrawal.id}`,
    );
    await expect
      .poll(async () => (await ledger.records()).withdrawals[0]?.status, {
        timeout: 5_000,
      })
      .toBe("done");
    expect(forgotten).toEqual(["send-1"]);
    await runtime.dispose();
  });

  it("takes the token back and fails the withdrawal when the outbox gives up", async () => {
    const { ledger, wallet } = setup();
    const fake = fakeNostr();
    const returned: string[] = [];
    createWithdrawals({
      ledger,
      nostr: fake.nostr,
      wallet: {
        ...wallet,
        returnSend: async (operationId) => {
          returned.push(operationId);
          return true;
        },
      },
    });
    const withdrawal = await linkyWithdrawal(ledger, "send-1");
    const [{ handler } = { handler: null }] = fake.outbox;
    await handler?.(
      new OutboxJobFailed({
        jobId: OutboxJobId.make("job-1"),
        ref: OutboxRef.make(`fazole.withdrawal:${withdrawal.id}`),
        reason: "identity-changed",
        detail: "",
      }),
    );
    expect(returned).toEqual(["send-1"]);
    expect((await ledger.records()).withdrawals[0]).toMatchObject({
      status: "failed",
      error: "identity-changed",
    });
  });

  it("after a reload queues a token the outbox never got, fails one cut off before its send, and returns a stray send", async () => {
    const { ledger, wallet } = setup();
    const queued: { to: Pubkey; token: string; ref: string }[] = [];
    const returned: string[] = [];
    const withdrawals = createWithdrawals({
      ledger,
      nostr: fakeNostr({
        sendToken: async (to, token, ref) => {
          queued.push({ to, token, ref });
          return enqueued(ref);
        },
      }).nostr,
      wallet: {
        ...wallet,
        pendingSends: async () => [
          pendingSend("send-1", 100),
          pendingSend("send-2", 200),
        ],
        returnSend: async (operationId) => {
          returned.push(operationId);
          return true;
        },
      },
    });
    const resumed = await linkyWithdrawal(ledger, "send-1");
    const cutOff = await linkyWithdrawal(ledger);
    await withdrawals.resume();
    expect(returned).toEqual(["send-2"]);
    expect(queued).toEqual([
      {
        to: recipient,
        token: tokenOf(100),
        ref: `fazole.withdrawal:${resumed.id}`,
      },
    ]);
    const { withdrawals: stored } = await ledger.records();
    expect(stored.find(({ id }) => id === resumed.id)?.status).toBe("pending");
    expect(stored.find(({ id }) => id === cutOff.id)).toMatchObject({
      status: "failed",
      error: "Interrupted",
    });
  });

  it("does not queue a token the outbox still holds", async () => {
    const { ledger, wallet, nostr, runtime } = onFakeRelay();
    const withdrawals = createWithdrawals({
      ledger,
      nostr,
      wallet: {
        ...wallet,
        pendingSends: async () => [pendingSend("send-1", 100)],
        returnSend: async () => true,
      },
    });
    const withdrawal = await linkyWithdrawal(ledger, "send-1");
    await nostr.sendToken(
      recipient,
      tokenOf(100),
      `fazole.withdrawal:${withdrawal.id}`,
    );
    await withdrawals.resume();
    expect([...(await nostr.queuedRefs())]).toEqual([
      `fazole.withdrawal:${withdrawal.id}`,
    ]);
    await runtime.dispose();
  });
});
