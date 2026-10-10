import { authTemplate, normalizeAudience } from "@linky-fit/linkauth";
import { isCanonicalAuthTemplate } from "@linky-fit/linkauth/signer";
import {
  NostrTransport,
  RelayPublishResult,
  type NostrTransportService,
  type RelayUrl,
} from "@linky-fit/linkstr";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import { Effect, Exit, Layer } from "effect";
import { verifyEvent } from "nostr-tools";
import { decrypt, getConversationKey } from "nostr-tools/nip44";
import { describe, expect, it } from "vitest";
import { deliverSiteLogin, signSiteLogin } from "./siteLoginSigner";

describe("signSiteLogin", () => {
  it("signs exactly the login template with the key, stamped now", () => {
    const { pubkey, secretKey } = makeIdentity();
    const audience = normalizeAudience("https://shop.example/cb") ?? "";
    const before = Math.floor(Date.now() / 1000);

    const signed = signSiteLogin(
      authTemplate({ audience, nonce: "n".repeat(22) }),
      secretKey,
    );

    expect(verifyEvent(signed)).toBe(true);
    expect(signed.pubkey).toBe(pubkey);
    expect(signed.created_at).toBeGreaterThanOrEqual(before);
    expect(isCanonicalAuthTemplate(signed, audience)).toBe(true);
  });
});

type PublishedEvent = Parameters<NostrTransportService["publish"]>[1];

describe("deliverSiteLogin", () => {
  const site = makeIdentity();
  const audience = "https://shop.example";
  const nonce = "n".repeat(22);
  const assertion = signSiteLogin(
    authTemplate({ audience, nonce }),
    makeIdentity().secretKey,
  );

  const run = (accepted: boolean, relays: ReadonlyArray<string>) => {
    const published: Array<{
      relays: ReadonlyArray<RelayUrl>;
      event: PublishedEvent;
    }> = [];
    const transport: NostrTransportService = {
      publish: (to, event) =>
        Effect.sync(() => {
          published.push({ relays: to, event });
          return to.map(
            (relay) =>
              new RelayPublishResult({ relay, accepted, detail: null }),
          );
        }),
      subscribe: () => Effect.succeed("closed"),
      fetch: () => Effect.succeed([]),
    };
    const exit = Effect.runSyncExit(
      deliverSiteLogin({ assertion, pubkey: site.pubkey, relays }).pipe(
        Effect.provide(Layer.succeed(NostrTransport, transport)),
      ),
    );
    return { exit, published };
  };

  it("publishes the assertion, encrypted to the site's key, to the document's relays", () => {
    const { exit, published } = run(true, ["wss://relay.shop.example"]);

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(published).toHaveLength(1);
    expect(published[0]?.relays).toEqual(["wss://relay.shop.example"]);
    const wrap = published[0]?.event;
    if (!wrap) throw new Error("nothing was published");
    expect(wrap.kind).toBe(1059);
    expect(wrap.tags).toEqual([
      ["p", site.pubkey],
      ["x", expect.stringMatching(/^[0-9a-f]{64}$/)],
      ["expiration", String(wrap.created_at + 600)],
    ]);
    expect(
      JSON.parse(
        decrypt(wrap.content, getConversationKey(site.secretKey, wrap.pubkey)),
      ),
    ).toMatchObject({ id: assertion.id, sig: assertion.sig });
  });

  it("never publishes to a relay that is not a wss relay", () => {
    const { published } = run(true, [
      "wss://relay.shop.example",
      "ws://relay.shop.example",
    ]);

    expect(published[0]?.relays).toEqual(["wss://relay.shop.example"]);
  });

  it("fails when no relay accepts the wrap", () => {
    const { exit } = run(false, ["wss://relay.shop.example"]);

    expect(Exit.isFailure(exit)).toBe(true);
    expect(JSON.stringify(exit)).toContain("SiteLoginNotDelivered");
  });
});
