import { Effect, Result } from "effect";
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
  linkauthAudience,
  parseNostrConnectUri,
} from "@linky-fit/linkstr";
import {
  authTemplate,
  createNonce,
  normalizeAudience,
} from "@linky-fit/linkauth";
import {
  connectNip46,
  linkauthLinks,
  readCallback,
} from "@linky-fit/linkauth/client";
import type { LinkauthRelayPool } from "@linky-fit/linkauth/client";
import {
  domainDocument,
  publicKeyOf,
  receiveLinkauth,
  verifyLinkauth,
} from "@linky-fit/linkauth/server";
import {
  buildCallbackUrl,
  isCanonicalAuthTemplate,
  resolveLinkauthLink,
  wrapAssertion,
} from "@linky-fit/linkauth/signer";
import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";

const AUDIENCE = "https://shop.example";
const idlePool: LinkauthRelayPool = {
  subscribeMany: () => ({ close: () => undefined }),
  publish: () => [],
};

/** A login across all entry points: client links, signer, callback, Nostr delivery, server. */
async function checkLinkauth() {
  const nonce = createNonce();
  const receiverKey = generateSecretKey();
  const document = domainDocument({
    audience: AUDIENCE,
    name: "Shop",
    pubkey: publicKeyOf(receiverKey),
    relays: ["wss://relay.example"],
    callbacks: [`${AUDIENCE}/login/done`],
  });
  const fetchDocument = () =>
    Promise.resolve(new Response(JSON.stringify(document)));
  const links = linkauthLinks({
    audience: AUDIENCE,
    nonce,
    callbackUrl: `${AUDIENCE}/login/done`,
  });

  const key = generateSecretKey();
  const sameDevice = await resolveLinkauthLink(links.openUrl, {
    fetch: fetchDocument,
  });
  if (!sameDevice.ok || sameDevice.login.delivery.kind !== "callback") {
    throw new Error("Signer did not resolve the client's same-device link");
  }
  const signed = finalizeEvent(
    { ...sameDevice.login.template, created_at: Math.floor(Date.now() / 1000) },
    key,
  );
  const returned = readCallback(
    buildCallbackUrl(sameDevice.login.delivery.url, signed),
  );
  if (returned === null || !("assertion" in returned)) {
    throw new Error("Callback did not carry the assertion");
  }
  const verified = verifyLinkauth(returned.assertion, {
    audience: AUDIENCE,
    nonce,
  });
  if (!verified.ok || verified.pubkey !== signed.pubkey) {
    throw new Error("Server did not accept the signed login");
  }

  const crossDevice = await resolveLinkauthLink(links.qrUrl, {
    fetch: fetchDocument,
  });
  if (!crossDevice.ok || crossDevice.login.delivery.kind !== "nostr") {
    throw new Error("Signer did not resolve the client's QR link");
  }
  const wrap = wrapAssertion(signed, crossDevice.login.delivery.pubkey);
  const received = await receiveLinkauth({
    secretKey: receiverKey,
    relays: crossDevice.login.delivery.relays,
    audience: AUDIENCE,
    nonce,
    pool: { querySync: () => Promise.resolve([wrap]) },
  });
  if (!received.ok || received.pubkey !== signed.pubkey) {
    throw new Error("Server did not receive the Nostr delivery");
  }

  const nip98 = finalizeEvent(
    {
      kind: 27235,
      tags: [["u", "https://npub.linky.fit/api"]],
      content: "",
      created_at: Math.floor(Date.now() / 1000),
    },
    key,
  );
  const refused = verifyLinkauth(nip98, { audience: AUDIENCE, nonce });
  if (refused.ok || refused.reason !== "wrong-kind") {
    throw new Error("A NIP-98 event passed as a login");
  }

  const nip46 = connectNip46({
    audience: AUDIENCE,
    nonce,
    name: "Shop",
    relays: ["wss://relay.example"],
    pool: idlePool,
  });
  const link = parseNostrConnectUri(nip46.uri);
  if (link === null || linkauthAudience(link) !== AUDIENCE) {
    throw new Error("The relay channel link does not bind the audience");
  }
  const template = authTemplate({ audience: AUDIENCE, nonce });
  if (
    normalizeAudience(`${AUDIENCE}/path`) !== AUDIENCE ||
    !isCanonicalAuthTemplate(template, AUDIENCE)
  ) {
    throw new Error("Shared audience helpers disagree");
  }

  nip46.cancel();
  const ended = await nip46.assertion.then(
    () => null,
    (error: unknown) => error,
  );
  if (!(ended instanceof Error) || ended.name !== "LinkauthError") {
    throw new Error("Cancelling did not end the relay channel");
  }
}

export async function checkConsumer() {
  const bip39Seed = Bip39Seed.make(crypto.getRandomValues(new Uint8Array(64)));
  await runLinkshu(
    { bip39Seed },
    Effect.gen(function* () {
      const tokens = yield* Tokens;
      const balances = yield* tokens.balances;
      if (balances.total !== 0) throw new Error("Fresh wallet has a balance");
      const receive = yield* Receive;
      const result = yield* Effect.result(
        receive.receive(new ReceiveDraft({ text: "not a cashu token" })),
      );
      if (
        !Result.isFailure(result) ||
        result.failure._tag !== "TokenParseFailed"
      ) {
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
  await checkLinkauth();
  console.log(
    "Packed packages: wallet, typed errors, Lightning subpath, Nostr keys and linkauth passed",
  );
}
