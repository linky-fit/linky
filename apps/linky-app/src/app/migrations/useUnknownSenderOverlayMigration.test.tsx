import { RumorId } from "@linky-fit/linkstr";
import {
  makeUnknownSendersRepository,
  NonEmptyString,
  ShardDbError,
} from "@linky-fit/linksync";
import { Effect } from "effect";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { makeTestLinkyStore } from "../../testUtils/linkyStore";
import { renderIntoDocument } from "../../testUtils/renderIntoDocument";
import { UNKNOWN_CONTACT_ID_PREFIX } from "../../utils/constants";
import {
  overlayRowsToImport,
  unknownSenderOverlayKey,
} from "./unknownSenderOverlayMigration";
import { useUnknownSenderOverlayMigration } from "./useUnknownSenderOverlayMigration";

const OWNER = "owner-1";
const UNKNOWN_SENDER = "a1".repeat(32);
const message = (n: number) => {
  const rumorId = RumorId.make(n.toString(16).padStart(64, "0"));
  return {
    id: `local-${n}`,
    contactId: `${UNKNOWN_CONTACT_ID_PREFIX}${UNKNOWN_SENDER}`,
    direction: "in",
    content: `hello ${n}`,
    wrapId: rumorId,
    rumorId,
    pubkey: UNKNOWN_SENDER,
    createdAtSec: 100 + n,
  };
};

afterEach(() => localStorage.clear());

describe("useUnknownSenderOverlayMigration", () => {
  it("imports the overlay once hydrated, without duplicating what is there, then clears it", async () => {
    const { store } = makeTestLinkyStore();
    const unknownSenders = makeUnknownSendersRepository(store);
    const key = unknownSenderOverlayKey(OWNER);
    localStorage.setItem(key, JSON.stringify([message(1), message(2)]));
    const Probe = ({ hydrated }: { hydrated: boolean }) => {
      useUnknownSenderOverlayMigration({
        appOwnerId: OWNER,
        hydrated,
        unknownSenders,
      });
      return null;
    };

    const view = await renderIntoDocument(<Probe hydrated={false} />);
    await act(async () => {});
    expect(await Effect.runPromise(unknownSenders.all)).toEqual([]);
    expect(localStorage.getItem(key)).not.toBeNull();

    // Another device already stored message 1 and the user edited it there.
    const [first] = overlayRowsToImport([message(1)], () => false);
    if (!first) throw new Error("overlay row expected");
    await Effect.runPromise(
      unknownSenders.insert({
        ...first,
        content: NonEmptyString.orThrow("hello 1, edited"),
      }),
    );
    await view.rerender(<Probe hydrated />);
    await act(async () => {});

    const rows = await Effect.runPromise(unknownSenders.all);
    expect(rows.map((row) => row.content).sort()).toEqual([
      "hello 1, edited",
      "hello 2",
    ]);
    expect(localStorage.getItem(key)).toBeNull();
    await view.unmount();
  });

  it("the overlay stays when the write fails", async () => {
    const key = unknownSenderOverlayKey(OWNER);
    localStorage.setItem(key, JSON.stringify([message(1)]));
    const unknownSenders = {
      insertIfAbsent: () =>
        Effect.fail(
          new ShardDbError({
            table: "unknownSenderMessage",
            message: "write failed",
          }),
        ),
    };
    const Probe = () => {
      useUnknownSenderOverlayMigration({
        appOwnerId: OWNER,
        hydrated: true,
        unknownSenders,
      });
      return null;
    };

    const view = await renderIntoDocument(<Probe />);
    await act(async () => {});

    expect(localStorage.getItem(key)).not.toBeNull();
    await view.unmount();
  });
});
