import { Effect, Either } from "effect";
import {
  Bip39Seed,
  Receive,
  ReceiveDraft,
  Tokens,
  runLinkshu,
} from "@linky-fit/linkshu";
import { getLightningAddressRequestUrl } from "@linky-fit/linkshu/lightning-address";
import {
  NostrSecretKey,
  derivePubkey,
  encodeNpub,
  decodeNpub,
} from "@linky-fit/linkstr";

export async function checkConsumer() {
  const bip39Seed = Bip39Seed.make(crypto.getRandomValues(new Uint8Array(64)));
  await runLinkshu(
    { bip39Seed },
    Effect.gen(function* () {
      const tokens = yield* Tokens;
      const balances = yield* tokens.balances;
      if (balances.total !== 0) throw new Error("Fresh wallet has a balance");
      const receive = yield* Receive;
      const result = yield* Effect.either(
        receive.receive(new ReceiveDraft({ text: "not a cashu token" })),
      );
      if (!Either.isLeft(result) || result.left._tag !== "TokenParseFailed") {
        throw new Error("Invalid token did not return the public typed error");
      }
    }),
  );
  if (
    getLightningAddressRequestUrl("Dave@example.com") !==
    "https://example.com/.well-known/lnurlp/dave"
  ) {
    throw new Error("Lightning address entry point failed");
  }

  const secret = NostrSecretKey.make(
    crypto.getRandomValues(new Uint8Array(32)),
  );
  const pubkey = derivePubkey(secret);
  if (decodeNpub(encodeNpub(pubkey)) !== pubkey) {
    throw new Error("Nostr identity codec roundtrip failed");
  }
  console.log(
    "Packed packages: wallet, typed errors, Lightning subpath and Nostr keys passed",
  );
}
