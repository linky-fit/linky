import { PrivateDirectMessage } from "nostr-tools/kinds";
import { npubEncode } from "nostr-tools/nip19";
import { unwrapEvent } from "nostr-tools/nip59";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import type { Event } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";
import { handleContactRequest } from "./contact";
import type { Publish } from "./contact";

const recipientKeys = [generateSecretKey(), generateSecretKey()];
const recipientPubkeys = recipientKeys.map((key) => getPublicKey(key));
const recipients = recipientPubkeys.map((pubkey) => npubEncode(pubkey));
const relays = ["wss://one.test", "wss://two.test"];

const contact = {
  email: "lumen@example.com",
  message: "Máme kavárnu a rádi bychom fazole vyzkoušeli.",
};

const contactRequest = (body: unknown, method = "POST") =>
  new Request("https://fazole.fit/api/contact", {
    method,
    headers: { "content-type": "application/json" },
    body: method === "POST" ? JSON.stringify(body) : null,
  });

const accepting = (): Publish & { readonly sent: [string[], Event][] } => {
  const sent: [string[], Event][] = [];
  const publish: Publish = (toRelays, event) => {
    sent.push([[...toRelays], event]);
    return Promise.resolve(
      toRelays.map(() => ({ status: "fulfilled", value: "" }) as const),
    );
  };
  return Object.assign(publish, { sent });
};

const rejecting: Publish = (toRelays) =>
  Promise.resolve(
    toRelays.map(
      () => ({ status: "rejected", reason: new Error("blocked") }) as const,
    ),
  );

describe("handleContactRequest", () => {
  it("sends the message as one rumor tagging every recipient, wrapped for each, to the relays", async () => {
    const publish = accepting();

    const response = await handleContactRequest(contactRequest(contact), {
      recipients,
      relays,
      publish,
      now: () => 1_700_000_000_000,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "OK" });
    expect(publish.sent.map(([toRelays]) => toRelays)).toEqual([
      relays,
      relays,
    ]);

    const rumors = recipientKeys.map((key, index) => {
      const sentToRecipient = publish.sent[index];
      if (sentToRecipient === undefined) throw new Error("No wrap sent");
      return unwrapEvent(sentToRecipient[1], key);
    });
    expect(new Set(rumors.map((rumor) => rumor.id)).size).toBe(1);
    const rumor = rumors[0];
    if (rumor === undefined) throw new Error("No rumor");
    expect(rumor.kind).toBe(PrivateDirectMessage);
    expect(rumor.created_at).toBe(1_700_000_000);
    expect(rumor.tags).toEqual([
      ...recipientPubkeys.map((pubkey) => ["p", pubkey]),
      ["subject", "fazole.fit: lumen@example.com"],
    ]);
    expect(rumor.content).toBe(
      `Email: lumen@example.com\n\n${contact.message}`,
    );
    expect(recipientPubkeys).not.toContain(rumor.pubkey);
  });

  it("uses a fresh key for every message", async () => {
    const publish = accepting();
    await handleContactRequest(contactRequest(contact), {
      recipients,
      relays,
      publish,
    });
    await handleContactRequest(contactRequest(contact), {
      recipients,
      relays,
      publish,
    });
    const senders = new Set(
      publish.sent.map(
        ([, wrap], index) =>
          unwrapEvent(wrap, recipientKeys[index % 2] ?? recipientKeys[0]!)
            .pubkey,
      ),
    );
    expect(senders.size).toBe(2);
  });

  it("answers a bot that filled the hidden field as if sent, and sends nothing", async () => {
    const publish = accepting();
    const response = await handleContactRequest(
      contactRequest({ ...contact, website: "https://spam.example" }),
      { recipients, relays, publish },
    );
    expect(response.status).toBe(200);
    expect(publish.sent).toEqual([]);
  });

  it("rejects a body without a way to reach the sender", async () => {
    const publish = accepting();
    const response = await handleContactRequest(
      contactRequest({ message: "Hello" }),
      { recipients, relays, publish },
    );
    expect(response.status).toBe(400);
    expect(publish.sent).toEqual([]);
  });

  it("reports when no relay accepted the message", async () => {
    const response = await handleContactRequest(contactRequest(contact), {
      recipients,
      relays,
      publish: rejecting,
    });
    expect(response.status).toBe(502);
  });

  it("allows only POST", async () => {
    const response = await handleContactRequest(contactRequest(null, "GET"), {
      recipients,
      relays,
      publish: accepting(),
    });
    expect(response.status).toBe(405);
  });
});
