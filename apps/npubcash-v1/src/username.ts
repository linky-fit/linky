import { Schema } from "effect";
import jwt from "jsonwebtoken";
import type { ServiceConfig } from "./config";
import type { ClaimKey, Database } from "./db";
import { describeError, failure, json } from "./responses";
import type { Minter } from "./minter";

const USERNAME = /^(?!npub1)[a-z0-9]+$/;
const DEFAULT_USERNAME_FEE_SATS = 5_000;
const SPECIAL_USERNAME_FEE_SATS: Readonly<Record<string, number>> = {
  satoshi: 1_000_000,
};

// Old apps match these strings exactly.
const INVOICE_UNPAID = "Invoice unpaid...";
const FORBIDDEN = "Forbidden!";

const UsernameRequest = Schema.Struct({
  username: Schema.optional(Schema.String),
  paymentToken: Schema.optional(Schema.String),
});
type UsernameRequest = typeof UsernameRequest.Type;
export const decodeUsernameRequest = Schema.decodeUnknownSync(UsernameRequest);

/** Tokens the fork issued before 2026-05-29 carry no `quoteId` or `amount`. */
const PaymentTokenPayload = Schema.Struct({
  pubkey: Schema.String,
  username: Schema.String,
  quoteId: Schema.optional(Schema.String),
  amount: Schema.optional(Schema.Number),
});
const decodePaymentTokenPayload = Schema.decodeUnknownSync(PaymentTokenPayload);

export const usernameFeeSats = (name: string) =>
  SPECIAL_USERNAME_FEE_SATS[name] ?? DEFAULT_USERNAME_FEE_SATS;

interface UsernameDeps {
  config: ServiceConfig;
  db: Database;
  minter: Minter;
}

/** The fork's two-step purchase: without `paymentToken` it offers an invoice, with one it sets the paid name. */
export async function putUsername(
  deps: UsernameDeps,
  pubkey: string,
  { username, paymentToken }: UsernameRequest,
): Promise<Response> {
  if (!username) return failure(400, "Missing parameters");
  const name = username.toLowerCase().trim();
  if (!USERNAME.test(name) || name.length < 3) {
    return failure(400, "Invalid username");
  }
  if ((await deps.db.user(pubkey))?.name) {
    return failure(400, "Username already set");
  }
  if (await deps.db.nameTaken(name)) {
    return failure(400, "This username is already taken");
  }
  return paymentToken
    ? finalizePurchase(deps, pubkey, name, paymentToken)
    : offerInvoice(deps, pubkey, name);
}

async function offerInvoice(
  { config, db, minter }: UsernameDeps,
  pubkey: string,
  name: string,
): Promise<Response> {
  const amount = usernameFeeSats(name);
  const quote = await minter.mint(config.defaultMintUrl).createMintQuoteBolt11({
    amount,
    unit: "sat",
    description: "Username fee",
  });
  await db.insertClaim({
    mint_url: config.defaultMintUrl,
    quote_id: quote.quote,
    pubkey: config.operatorPubkey,
    amount,
    output_amounts: null,
    status: "unpaid",
  });
  const paymentToken = jwt.sign(
    {
      pubkey,
      username: name,
      quoteId: quote.quote,
      paymentRequest: quote.request,
      amount,
    },
    config.jwtSecret,
  );
  return json(402, {
    error: true,
    message: "Payment required",
    data: { paymentToken, paymentRequest: quote.request },
  });
}

async function finalizePurchase(
  { config, db, minter }: UsernameDeps,
  pubkey: string,
  name: string,
  paymentToken: string,
): Promise<Response> {
  let payload: typeof PaymentTokenPayload.Type;
  try {
    payload = decodePaymentTokenPayload(
      jwt.verify(paymentToken, config.jwtSecret),
    );
  } catch {
    return failure(400, "Invalid payment token");
  }
  if (payload.pubkey !== pubkey) return failure(403, FORBIDDEN);
  if (!payload.quoteId || !payload.amount) {
    return failure(402, INVOICE_UNPAID);
  }
  // The fork checked neither, so a 5,000 sat token could finalize `satoshi`.
  if (payload.username !== name || payload.amount !== usernameFeeSats(name)) {
    return failure(403, FORBIDDEN);
  }

  const key: ClaimKey = {
    mint_url: config.defaultMintUrl,
    quote_id: payload.quoteId,
  };
  await db.insertClaim({
    ...key,
    pubkey: config.operatorPubkey,
    amount: payload.amount,
    output_amounts: null,
    status: "unpaid",
  });
  const fee = await db.claim(key);
  if (fee) {
    try {
      await minter.advance(fee);
    } catch (error) {
      console.warn(
        `[npubcash-v1] username fee ${key.quote_id}: ${describeError(error)}`,
      );
    }
  }
  // Proofs count even after the operator spent them; none means unpaid or minted by someone else.
  if (!(await db.claim(key))?.proofs) return failure(402, INVOICE_UNPAID);

  try {
    if (await db.setName(pubkey, name, config.defaultMintUrl)) {
      return json(200, { error: false });
    }
  } catch (error) {
    console.warn(`[npubcash-v1] setting a name: ${describeError(error)}`);
  }
  return failure(500, "Failed to update db");
}
