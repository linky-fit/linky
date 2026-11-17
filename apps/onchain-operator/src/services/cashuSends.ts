import { OperationId, type SendError } from "@linky-fit/linkshu";
import { parsePubkey, RelayUrl, type Pubkey } from "@linky-fit/linkstr";
import { Result, Schema } from "effect";
import { LINKY_NAME_DOMAIN, type MintFunds } from "../domain/wallet";
import type { Nostr } from "./nostr";
import type { Wallet } from "./wallet";

/** The ref of a token message the Wallet screen sent: the prefix, then the wallet send's operation id. */
const SEND_REF = "wallet-send:";

export interface CashuRecipient {
  readonly pubkey: Pubkey;
  /** Where the recipient reads, as their NIP-05 lists them. */
  readonly relays: readonly RelayUrl[];
}

export type CashuSendFailure =
  /** Linky has no account of that name. */
  | { readonly reason: "nameNotFound" }
  | { readonly reason: "lookupFailed" }
  | { readonly reason: "sendFailed"; readonly error: SendError["_tag"] }
  /** The outbox did not take the message; the token went back to the wallet. */
  | { readonly reason: "notQueued" };

export interface CashuSends {
  /** The account behind a Linky name, from its NIP-05 on Linky's domain. */
  readonly resolveName: (
    name: string,
  ) => Promise<Result.Result<CashuRecipient, CashuSendFailure>>;
  /** Sends `amount` from the mint as a Cashu token in a Nostr message; the token goes back to the wallet if no relay takes it. */
  readonly send: (
    recipient: CashuRecipient,
    source: MintFunds,
    amount: number,
  ) => Promise<Result.Result<void, CashuSendFailure>>;
}

const Nip05Json = Schema.Struct({
  names: Schema.Record(Schema.String, Schema.String),
  relays: Schema.optionalKey(
    Schema.Record(Schema.String, Schema.Array(Schema.String)),
  ),
});
const decodeNip05 = Schema.decodeUnknownOption(Nip05Json);
const isRelayUrl = Schema.is(RelayUrl);

export const createCashuSends = ({
  wallet,
  nostr,
  nip05Fetch,
}: {
  readonly wallet: Wallet;
  readonly nostr: Nostr;
  readonly nip05Fetch: typeof fetch;
}): CashuSends => {
  nostr.onOutboxResult(SEND_REF, async (result) => {
    const operationId = OperationId.make(result.ref.slice(SEND_REF.length));
    if (result._tag === "OutboxJobSucceeded") {
      await wallet.forgetSend(operationId);
      return;
    }
    // Unacknowledged, so the next session tries again.
    if ((await wallet.takeBack(operationId)) === "mintUnreachable")
      throw new Error("Mint unreachable");
  });

  return {
    resolveName: async (name) => {
      const url = new URL(
        `https://${LINKY_NAME_DOMAIN}/.well-known/nostr.json`,
      );
      url.searchParams.set("name", name);
      try {
        const response = await nip05Fetch(url, {
          headers: { Accept: "application/json" },
        });
        if (!response.ok) return Result.fail({ reason: "lookupFailed" });
        const body = decodeNip05(await response.json());
        if (body._tag === "None")
          return Result.fail({ reason: "lookupFailed" });
        const hex = body.value.names[name];
        const pubkey = hex === undefined ? null : parsePubkey(hex);
        if (pubkey === null) return Result.fail({ reason: "nameNotFound" });
        return Result.succeed({
          pubkey,
          relays: (body.value.relays?.[hex ?? ""] ?? []).filter(isRelayUrl),
        });
      } catch (error) {
        console.warn("[onchain-operator] Linky name not looked up", error);
        return Result.fail({ reason: "lookupFailed" });
      }
    },
    send: async (recipient, source, amount) => {
      const sent = await wallet.send(source.mint, amount, false);
      if (Result.isFailure(sent))
        return Result.fail({ reason: "sendFailed", error: sent.failure._tag });
      const { operationId, tokenText } = sent.success;
      try {
        await nostr.sendToken(
          recipient.pubkey,
          tokenText,
          `${SEND_REF}${operationId}`,
          recipient.relays,
        );
        return Result.succeed(undefined);
      } catch (error) {
        console.warn("[onchain-operator] Cashu not queued", error);
        await wallet.takeBack(operationId);
        return Result.fail({ reason: "notQueued" });
      }
    },
  };
};
