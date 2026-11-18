import { createId } from "@linky-fit/linksync";
import {
  EsploraError,
  type EsploraClient,
  type EsploraTransaction,
} from "@linky-fit/onchain-transfer";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  onchainTransferUpdateFixture,
  onchainTransferViewFixture,
} from "../../testUtils/onchainTransfers";
import { checkOnchainPayouts } from "./onchainPayouts";

const SHARED_ADDRESS = "bcrt1qshared";
const OTHER_ADDRESS = "bcrt1qother";

const payout = (txid: string, address: string): EsploraTransaction => ({
  txid,
  vout: [{ scriptpubkey_address: address, value: 100_000 }],
  status: { confirmed: true, block_height: 10, block_time: 1_700_000_100 },
});

const esploraOf = (
  byAddress: Record<string, ReadonlyArray<EsploraTransaction>>,
): EsploraClient => ({
  addressTransactions: (address) => {
    const transactions = byAddress[address];
    return transactions === undefined
      ? Effect.fail(new EsploraError({ url: address, message: "offline" }))
      : Effect.succeed(transactions);
  },
  addressStats: () => Effect.die("unused"),
  tipHeight: () => Effect.die("unused"),
  transaction: () => Effect.die("unused"),
});

const sent = (payoutAddress: string, createdAtSec: number) =>
  onchainTransferViewFixture({
    phase: "sent",
    payoutAddress,
    createdAtSec,
  });

describe("checkOnchainPayouts", () => {
  it("gives the sends to the address their payouts oldest first, skipping one already settling a transfer and other addresses' sends", async () => {
    const completedId = createId<"OnchainTransfer">();
    const completed = onchainTransferViewFixture({
      id: completedId,
      phase: "completed",
      payoutAddress: SHARED_ADDRESS,
      update: onchainTransferUpdateFixture(completedId, {
        status: "completed",
        txid: "settled",
      }),
    });
    const newer = sent(SHARED_ADDRESS, 1_700_000_050);
    const older = sent(SHARED_ADDRESS, 1_700_000_000);
    const esplora = esploraOf({
      [SHARED_ADDRESS]: [
        payout("settled", SHARED_ADDRESS),
        payout("first", SHARED_ADDRESS),
      ],
    });

    const checks = await Effect.runPromise(
      checkOnchainPayouts(
        [completed, newer, older, sent(OTHER_ADDRESS, 1_700_000_000)],
        SHARED_ADDRESS,
        esplora,
      ),
    );

    expect(checks).toEqual([
      { id: older.id, check: { _tag: "found", txid: "first" } },
      { id: newer.id, check: { _tag: "notFound" } },
    ]);
  });

  it("reports a failed lookup for every send to the address", async () => {
    const first = sent("bcrt1qoffline", 1_700_000_000);
    const second = sent("bcrt1qoffline", 1_700_000_050);

    const checks = await Effect.runPromise(
      checkOnchainPayouts([first, second], "bcrt1qoffline", esploraOf({})),
    );

    expect(checks).toEqual([
      { id: first.id, check: { _tag: "failed", message: "offline" } },
      { id: second.id, check: { _tag: "failed", message: "offline" } },
    ]);
  });
});
