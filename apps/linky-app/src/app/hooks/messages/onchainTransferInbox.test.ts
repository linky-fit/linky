import {
  createId,
  makeOnchainTransfersRepository,
  type OnchainTransferId,
} from "@linky-fit/linksync";
import {
  AppMessageReceived,
  AppNamespace,
  Pubkey,
  RumorId,
  UnixSeconds,
} from "@linky-fit/linkstr";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import {
  decodeTransferUpdateColumn,
  onchainTransferChannel,
  type OnchainTransferMessage,
} from "@linky-fit/onchain-transfer";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { makeTestLinkyStore } from "../../../testUtils/linkyStore";
import {
  REGTEST_ADDRESS,
  onchainConfigFixture,
  onchainTransferUpdateFixture,
} from "../../../testUtils/onchainTransfers";
import { planOnchainTransfer } from "../../lib/onchainTransfers";
import { applyOnchainTransferAppMessage } from "./onchainTransferInbox";

const me = makeIdentity().pubkey;
const operator = Pubkey.make(makeIdentity().pubkey);

let messageCount = 0;

const received = (
  message: OnchainTransferMessage,
  from: Pubkey = operator,
  app = onchainTransferChannel.app,
): AppMessageReceived =>
  new AppMessageReceived({
    messageId: RumorId.make((messageCount += 1).toString(16).padStart(64, "0")),
    from,
    app,
    content: onchainTransferChannel.draft(me, message).content,
    clientId: null,
    sentAt: UnixSeconds.make(1_700_000_000),
  });

const setup = (peer: Pubkey = operator) => {
  const transfers = makeOnchainTransfersRepository(makeTestLinkyStore().store);
  const id = createId<"OnchainTransfer">();
  const planned = planOnchainTransfer({
    draft: { direction: "receive", amount: null, payoutAddress: "" },
    config: onchainConfigFixture(),
    id,
    nowSec: 1_700_000_000,
    operator: peer,
    userPaymentRequest: "creqAuser",
  });
  if (planned === null) throw new Error("unplannable transfer");
  Effect.runSync(transfers.insert(planned.row));
  const onUpdated = vi.fn();
  const apply = (event: AppMessageReceived) =>
    applyOnchainTransferAppMessage(event, { operator, transfers, onUpdated });
  const row = () => Effect.runSync(transfers.byId(id));
  return { apply, id, onUpdated, row, transfers };
};

const storedRevision = (row: { updateJson: string | null } | null) =>
  decodeTransferUpdateColumn(row?.updateJson ?? null)?.revision ?? null;

const accepted = (id: OnchainTransferId, revision = 1) =>
  onchainTransferUpdateFixture(id, {
    revision,
    depositAddress: REGTEST_ADDRESS,
  });

describe("applyOnchainTransferAppMessage", () => {
  it("stores the operator's update with the deposit address", async () => {
    const { apply, id, row } = setup();
    expect(await apply(received(accepted(id)))).toEqual({ ok: true });
    expect(row()).toMatchObject({ depositAddress: REGTEST_ADDRESS });
    expect(decodeTransferUpdateColumn(row()?.updateJson ?? null)).toMatchObject(
      {
        status: "accepted",
        revision: 1,
      },
    );
  });

  it("keeps the newest revision through replays and reordering", async () => {
    const { apply, id, row } = setup();
    const seen = onchainTransferUpdateFixture(id, {
      revision: 2,
      status: "fundsSeen",
      confirmations: 1,
    });
    await apply(received(seen));
    const afterSeen = row();
    await apply(received(accepted(id)));
    await apply(received(seen));
    expect(row()).toEqual(afterSeen);
    expect(storedRevision(row())).toBe(2);

    await apply(
      received(
        onchainTransferUpdateFixture(id, {
          revision: 3,
          status: "fundsReceived",
        }),
      ),
    );
    expect(storedRevision(row())).toBe(3);
  });

  it("reports each newer update once with its transfer, never a replay", async () => {
    const { apply, id, onUpdated } = setup();
    await apply(received(accepted(id)));
    await apply(received(accepted(id)));

    expect(onUpdated).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ status: "accepted", revision: 1 }),
      expect.objectContaining({ id, direction: "receive", amount: 100_000 }),
    );
  });

  it("trusts only the operator, and only for a transfer held with it", async () => {
    const stranger = Pubkey.make(makeIdentity().pubkey);
    const { apply, id, row } = setup();
    await apply(received(accepted(id), stranger));
    expect(row()?.updateJson).toBeNull();

    const other = setup(stranger);
    await other.apply(received(accepted(other.id)));
    expect(other.row()?.updateJson).toBeNull();
  });

  it("ignores requests, cancels, other apps and unknown transfers", async () => {
    const { apply, id, row, transfers } = setup();
    await apply(received({ v: 1, type: "cancel", transferId: id }));
    await apply(
      received(accepted(id), operator, AppNamespace.make("linky.other")),
    );
    expect(row()?.updateJson).toBeNull();

    const unknown = createId<"OnchainTransfer">();
    expect(await apply(received(accepted(unknown)))).toEqual({ ok: true });
    expect(Effect.runSync(transfers.byId(unknown))).toBeNull();
  });
});
