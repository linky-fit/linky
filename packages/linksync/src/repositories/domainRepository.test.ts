import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { ShardDbError } from "../core";
import { createId } from "../model/ids";
import { linkyStore, runNow } from "../testing/linky";
import { domainTableRepository } from "./domainRepository";

describe("domainTableRepository", () => {
  it("encodes booleans as SqliteBoolean on disk and decodes them back as booleans", () => {
    const { db, store } = linkyStore();
    const contacts = domainTableRepository(store, "contacts", "contact");
    const id = createId<"Contact">();

    runNow(
      contacts.insert({
        id,
        name: "Alice",
        nameSetByUser: true,
        lnAddressSetByUser: false,
      }),
    );

    const [raw] = runNow(db.readTable("contact"));
    expect(raw?.nameSetByUser).toBe(1);
    expect(raw?.lnAddressSetByUser).toBe(0);
    expect(raw?.archivedAtSec).toBeNull();

    const record = runNow(contacts.byId(id));
    expect(record).toMatchObject({
      id,
      name: "Alice",
      nameSetByUser: true,
      lnAddressSetByUser: false,
      archivedAtSec: null,
    });
    expect(record).not.toHaveProperty("isDeleted");

    runNow(contacts.update(id, { nameSetByUser: null }));
    expect(runNow(contacts.byId(id))?.nameSetByUser).toBeNull();
    expect(runNow(db.readTable("contact"))[0]?.nameSetByUser).toBeNull();
  });

  it("omits undefined optional fields on insert while preserving explicit null", () => {
    const { store } = linkyStore();
    const subscriptions = domainTableRepository(
      store,
      "keryx",
      "keryxSubscription",
    );
    const id = createId<"KeryxSubscription">();

    runNow(
      subscriptions.insert({
        id,
        origin: "https://example.com",
        trustJson: "{}",
        identityJson: "{}",
        channelsJson: "[]",
        pairedAtSec: 1_000,
        privateFeedsJson: '["https://example.com/feed"]',
      }),
    );
    expect(runNow(subscriptions.byId(id))?.privateFeedsJson).toBe(
      '["https://example.com/feed"]',
    );

    runNow(
      subscriptions.insert({
        id,
        origin: "https://example.com",
        trustJson: "{}",
        identityJson: "{}",
        channelsJson: "[]",
        pairedAtSec: 2_000,
        privateFeedsJson: null,
      }),
    );
    expect(runNow(subscriptions.byId(id))?.privateFeedsJson).toBeNull();
  });

  it("fails with ShardDbError on invalid column values", () => {
    const { store } = linkyStore();
    const contacts = domainTableRepository(store, "contacts", "contact");
    const transfers = domainTableRepository(
      store,
      "onchain",
      "onchainTransfer",
    );
    const contactId = createId<"Contact">();

    const emptyName = Effect.runSyncExit(
      contacts.insert({ id: contactId, name: "" }),
    );
    expect(Exit.isFailure(emptyName)).toBe(true);
    if (Exit.isFailure(emptyName)) {
      const error = Effect.runSync(
        Effect.flip(contacts.insert({ id: contactId, name: "" })),
      );
      expect(error).toBeInstanceOf(ShardDbError);
      expect(error.table).toBe("contact");
      expect(error.message).toBe("invalid name");
    }

    const tooLong = Effect.runSync(
      Effect.flip(contacts.insert({ id: contactId, name: "x".repeat(1001) })),
    );
    expect(tooLong).toBeInstanceOf(ShardDbError);

    const zeroSec = Effect.runSync(
      Effect.flip(contacts.insert({ id: contactId, archivedAtSec: 0 })),
    );
    expect(zeroSec).toBeInstanceOf(ShardDbError);

    const negativeFee = Effect.runSync(
      Effect.flip(
        transfers.insert({
          id: createId<"OnchainTransfer">(),
          createdAtSec: 1_000,
          role: "user",
          peerPubkey: "ab".repeat(32),
          direction: "send",
          amount: 100,
          feeBasisPoints: -1,
        }),
      ),
    );
    expect(negativeFee).toBeInstanceOf(ShardDbError);
    expect(negativeFee.message).toBe("invalid feeBasisPoints");
  });
});
