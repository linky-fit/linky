import { Schema } from "effect";
import { finalizeEvent, nip19, nip98 } from "nostr-tools";
import { NPUBCASH_SERVER_URL } from "./stack";

const PayRequest = Schema.Struct({ callback: Schema.String });
const Invoice = Schema.Struct({ pr: Schema.String });
const UserInfo = Schema.Struct({
  data: Schema.Struct({
    user: Schema.Struct({
      name: Schema.optional(Schema.String),
      mintUrl: Schema.String,
    }),
  }),
});

/**
 * Asks the stack's npubcash-server for an invoice to `user` (an npub or a
 * bought name); the FakeWallet mint settles it on its own, so this pays the
 * address.
 */
export const payLightningAddress = async (
  user: string,
  sats: number,
): Promise<void> => {
  const payRequest = Schema.decodeUnknownSync(PayRequest)(
    await (
      await fetch(`${NPUBCASH_SERVER_URL}/.well-known/lnurlp/${user}`)
    ).json(),
  );
  const callback = new URL(payRequest.callback);
  callback.searchParams.set("amount", String(sats * 1000));
  Schema.decodeUnknownSync(Invoice)(await (await fetch(callback)).json());
};

/** The account `nsec` holds at the stack's npubcash-server. */
export const fetchUserInfo = async (nsec: string) => {
  const decoded = nip19.decode(nsec);
  if (decoded.type !== "nsec") throw new Error("not an nsec");
  const url = `${NPUBCASH_SERVER_URL}/api/v2/user/info`;
  const token = await nip98.getToken(
    url,
    "get",
    (event) => finalizeEvent(event, decoded.data),
    true,
  );
  const response = await fetch(url, { headers: { Authorization: token } });
  return Schema.decodeUnknownSync(UserInfo)(await response.json()).data.user;
};
