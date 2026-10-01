import { getPubKeyFromPrivKey } from "@cashu/cashu-ts";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { Effect } from "effect";
import {
  Amount,
  Mints,
  P2pkUnlockingKey,
  parseP2pkPubkey,
  Receive,
  ReceiveDraft,
  runLinkshu,
  Send,
  SendDraft,
} from "../../src";
import { fundToken, inputFee, mintUrl, randomSeed } from "./helpers";

/** A key whose own point has odd y, the case an x-only (Nostr) lock must survive. */
const oddKey = (): P2pkUnlockingKey => {
  for (;;) {
    const secret = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
    if (bytesToHex(getPubKeyFromPrivKey(hexToBytes(secret))).startsWith("03")) {
      return P2pkUnlockingKey.make(secret);
    }
  }
};

describe("P2PK-locked tokens against the local mint", () => {
  it("sends to an x-only key and only that key's holder receives it", async () => {
    const ownerKey = oddKey();
    const xOnly = bytesToHex(getPubKeyFromPrivKey(hexToBytes(ownerKey))).slice(
      2,
    );
    const lockTo = parseP2pkPubkey(xOnly);
    assert(lockTo !== null);
    const funded = await fundToken(32);

    const sent = await runLinkshu(
      { bip39Seed: randomSeed() },
      Effect.gen(function* () {
        expect((yield* (yield* Mints).info(mintUrl)).supportsP2pk).toBe(true);
        yield* (yield* Receive).receive(new ReceiveDraft({ text: funded }));
        return yield* (yield* Send).send(
          new SendDraft({
            mint: mintUrl,
            amount: Amount.make(8),
            produceAs: "pending",
            lockTo,
          }),
        );
      }),
    );
    expect(sent.lockTo).toBe(lockTo);

    const outcome = await runLinkshu(
      { bip39Seed: randomSeed() },
      Effect.gen(function* () {
        const receive = yield* Receive;
        const draft = new ReceiveDraft({ text: sent.tokenText });
        const withoutKey = yield* Effect.result(receive.receive(draft));
        const received = yield* receive.receive(draft, {
          unlockingKey: ownerKey,
        });
        return { withoutKey, received };
      }),
    );

    assert(outcome.withoutKey._tag === "Failure");
    expect(outcome.withoutKey.failure._tag).toBe("TokenLocked");
    expect(outcome.received.amount).toBe(8 - inputFee(sent.proofs.length));
  });
});
