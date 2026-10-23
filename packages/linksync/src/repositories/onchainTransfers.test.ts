import {
  NonEmptyString,
  NonEmptyString100,
  NonEmptyString1000,
  NonNegativeInt,
  PositiveInt,
} from "@evolu/common";
import { createId, onchainTransferMessageIdFor } from "@linky-fit/domain";
import { describe, expect, it } from "vitest";
import { linkyStore, runNow } from "../testing/linky";
import {
  makeOnchainTransferMessagesRepository,
  makeOnchainTransfersRepository,
} from "./onchainTransfers";

const id = createId<"OnchainTransfer">();

const transfer = {
  id,
  createdAtSec: PositiveInt.orThrow(1_000),
  role: NonEmptyString100.orThrow("user"),
  peerPubkey: NonEmptyString100.orThrow("ab".repeat(32)),
  direction: NonEmptyString100.orThrow("send"),
  amount: PositiveInt.orThrow(100_000),
  feeBasisPoints: NonNegativeInt.orThrow(100),
  payoutAddress: NonEmptyString1000.orThrow(
    "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
  ),
};

describe("on-chain transfers repository", () => {
  it("stores a transfer in the onchain scope", () => {
    const { store } = linkyStore();
    const transfers = makeOnchainTransfersRepository(store);
    runNow(transfers.insert(transfer));
    expect(runNow(transfers.all)).toMatchObject([
      { id, direction: "send", updateJson: null },
    ]);
  });

  it("skips a row whose creation columns have not synced yet", () => {
    const { db, store } = linkyStore();
    const transfers = makeOnchainTransfersRepository(store);
    runNow(
      db.mutate([
        {
          kind: "update",
          table: "onchainTransfer",
          ownerId: store.shardOwner("onchain", 0).id,
          row: { id, role: transfer.role, amount: transfer.amount },
        },
      ]),
    );
    expect(runNow(transfers.all)).toEqual([]);
    expect(runNow(transfers.byId(id))).toMatchObject({ id, direction: null });
  });

  it("writes the operator's update and the user's send time with update", () => {
    const { store } = linkyStore();
    const transfers = makeOnchainTransfersRepository(store);
    runNow(transfers.insert(transfer));
    const updateJson = NonEmptyString1000.orThrow('{"revision":1}');
    runNow(
      transfers.update(id, {
        updateJson,
        sentAtSec: PositiveInt.orThrow(2_000),
      }),
    );
    expect(runNow(transfers.byId(id))).toMatchObject({
      updateJson,
      sentAtSec: 2_000,
    });
  });

  it("keeps a received message once, in the onchain scope", () => {
    const { store } = linkyStore();
    const messages = makeOnchainTransferMessagesRepository(store);
    const rumorId = "cd".repeat(32);
    const message = {
      id: onchainTransferMessageIdFor(rumorId),
      rumorId: NonEmptyString100.orThrow(rumorId),
      peerPubkey: transfer.peerPubkey,
      transferId: id,
      content: NonEmptyString.orThrow('{"type":"request"}'),
      sentAtSec: PositiveInt.orThrow(1_000),
    };
    expect(runNow(messages.insertIfAbsent(message))).toBe(true);
    expect(runNow(messages.insertIfAbsent(message))).toBe(false);
    expect(runNow(messages.all)).toMatchObject([
      { rumorId, transferId: id, content: '{"type":"request"}' },
    ]);
  });
});
