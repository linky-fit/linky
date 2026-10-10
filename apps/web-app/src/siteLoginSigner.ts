import type { LinkauthAssertion, LinkauthTemplate } from "@linky-fit/linkauth";
import { wrapAssertion } from "@linky-fit/linkauth/signer";
import {
  LinkstrIdentity,
  NostrTransport,
  SignedPlainEvent,
  type NostrSecretKey,
  type RelayPublishResult,
} from "@linky-fit/linkstr";
import { linkstrRuntimeAtom } from "@linky-fit/linkstr-react";
import { Data, Effect, Schema } from "effect";
import { finalizeEvent } from "nostr-tools/pure";
import { isRelayUrl } from "./utils/nostrRelays";
import { nowSeconds } from "./utils/time";

export const signSiteLogin = (
  template: LinkauthTemplate,
  secretKey: NostrSecretKey,
): LinkauthAssertion =>
  finalizeEvent({ ...template, created_at: nowSeconds() }, secretKey);

/** Signs the login template with the identity's main key; fails with `LinkstrNotConfigured` while logged out. */
export const signSiteLoginAtom = linkstrRuntimeAtom.fn<LinkauthTemplate>()(
  (template) =>
    Effect.map(LinkstrIdentity, ({ secretKey }) =>
      signSiteLogin(template, secretKey),
    ),
);

export interface SiteLoginDelivery {
  assertion: LinkauthAssertion;
  /** The site's receiving key from its domain document. */
  pubkey: string;
  /** The relays from the site's domain document, not the user's own. */
  relays: ReadonlyArray<string>;
}

export class SiteLoginNotDelivered extends Data.TaggedError(
  "SiteLoginNotDelivered",
)<{ results: ReadonlyArray<RelayPublishResult> }> {}

/** Wraps a signed login to the site's key and publishes it; fails unless at least one relay accepts. */
export const deliverSiteLogin = ({
  assertion,
  pubkey,
  relays,
}: SiteLoginDelivery) =>
  Effect.gen(function* () {
    const transport = yield* NostrTransport;
    const wrap = yield* Schema.decodeUnknown(SignedPlainEvent)(
      wrapAssertion(assertion, pubkey),
    );
    const results = yield* transport.publish(relays.filter(isRelayUrl), wrap);
    if (!results.some((result) => result.accepted)) {
      return yield* new SiteLoginNotDelivered({ results });
    }
    return { wrapId: wrap.id, results };
  });

export const deliverSiteLoginAtom =
  linkstrRuntimeAtom.fn<SiteLoginDelivery>()(deliverSiteLogin);
