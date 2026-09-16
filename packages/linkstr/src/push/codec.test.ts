import { Either } from "effect";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";
import type { Event as NostrToolsEvent } from "nostr-tools";
import { Pubkey } from "../domain/primitives";
import { decodePushWrap, type PushWrapFailure } from "./codec";

const secretKey = generateSecretKey();
const recipient = Pubkey.make(getPublicKey(generateSecretKey()));
const otherRecipient = Pubkey.make(getPublicKey(generateSecretKey()));
const createdAt = 1_754_000_000;

const pushWrap = (
  tags: Array<Array<string>> = [
    ["p", recipient, "wss://relay-a.test"],
    ["p", recipient, "wss://relay-b.test"],
    ["linky", "push"],
  ],
  kind = 1059,
): NostrToolsEvent =>
  finalizeEvent(
    {
      kind,
      created_at: createdAt,
      content: "ciphertext",
      tags,
    },
    secretKey,
  );

const expectFailure = (input: unknown, failure: PushWrapFailure): void => {
  expect(decodePushWrap(input)).toEqual(
    expect.objectContaining({ _tag: "Left", left: failure }),
  );
};

describe("decodePushWrap", () => {
  it("decodes a valid push-marked gift wrap without exposing sender relay hints", () => {
    const wrap = pushWrap();

    expect(Either.getOrThrow(decodePushWrap(wrap))).toEqual({
      wrapId: wrap.id,
      recipient,
      createdAt,
    });
  });

  it("rejects an event without the push marker", () => {
    expectFailure(pushWrap([["p", recipient]]), "missing-push-marker");
  });

  it("rejects a marked event with a tampered signature", () => {
    const wrap = pushWrap();

    expectFailure({ ...wrap, content: "tampered" }, "invalid-signature");
  });

  it("rejects a marked event with multiple recipients", () => {
    expectFailure(
      pushWrap([
        ["p", recipient],
        ["p", otherRecipient],
        ["linky", "push"],
      ]),
      "unexpected-recipient-count",
    );
  });

  it("rejects a marked event with the wrong kind", () => {
    expectFailure(pushWrap(undefined, 1), "wrong-kind");
  });

  it("rejects a marked malformed event", () => {
    expectFailure({ tags: [["linky", "push"]] }, "malformed-event");
  });
});
