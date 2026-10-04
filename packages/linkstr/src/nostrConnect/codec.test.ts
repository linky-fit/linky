import { finalizeEvent, verifyEvent } from "nostr-tools";
import { decrypt, encrypt, getConversationKey } from "nostr-tools/nip44";
import { Schema } from "effect";
import { RelayUrl, UnixSeconds } from "../domain/primitives";
import { SignedPlainEvent } from "../internal/nostrEvent";
import { makeIdentity } from "../testing";
import {
  answerNostrConnectRequest,
  decodeNostrConnectRequest,
  encodeNostrConnectEvent,
  openNostrConnectChannel,
  parseNostrConnectUri,
} from "./codec";
import type { NostrConnectRpcRequest } from "./codec";
import { NostrConnectRequest } from "./domain";

const me = makeIdentity();
const client = makeIdentity();
const now = UnixSeconds.make(1_760_000_000);

const uri = (query: string, host: string = client.pubkey) =>
  `nostrconnect://${host}?${query}`;
const relay = `relay=${encodeURIComponent("wss://relay.test")}`;

describe("parseNostrConnectUri", () => {
  it("reads every field of a PEAU·RLA style uri", () => {
    const parsed = parseNostrConnectUri(
      uri(
        [
          relay,
          `relay=${encodeURIComponent("wss://relay-b.test")}`,
          "secret=s3cret",
          `perms=${encodeURIComponent("sign_event:27235, nip44_encrypt")}`,
          `name=${encodeURIComponent("PEAU·RLA")}`,
          `url=${encodeURIComponent("https://peaurla.test")}`,
          `image=${encodeURIComponent("https://peaurla.test/logo.png")}`,
        ].join("&"),
      ),
    );
    expect(parsed).toEqual(
      new NostrConnectRequest({
        clientPubkey: client.pubkey,
        relays: [
          RelayUrl.make("wss://relay.test"),
          RelayUrl.make("wss://relay-b.test"),
        ],
        secret: "s3cret",
        perms: ["sign_event:27235", "nip44_encrypt"],
        name: "PEAU·RLA",
        url: "https://peaurla.test",
        image: "https://peaurla.test/logo.png",
      }),
    );
  });

  it("tolerates whitespace, scheme and pubkey case, and absent optionals", () => {
    const parsed = parseNostrConnectUri(
      `  NostrConnect://${client.pubkey.toUpperCase()}?${relay}&secret=x\n`,
    );
    expect(parsed?.clientPubkey).toBe(client.pubkey);
    expect(parsed?.perms).toEqual([]);
    expect(parsed?.name).toBeNull();
    expect(parsed?.url).toBeNull();
    expect(parsed?.image).toBeNull();
  });

  it("drops non-wss and duplicate relays and caps them at five", () => {
    const relays = [
      "http://relay.test",
      "ws://relay.test",
      ...Array.from({ length: 7 }, (_, index) => `wss://r${index}.test`),
      "wss://r0.test",
    ];
    const parsed = parseNostrConnectUri(
      uri(
        [
          ...relays.map((url) => `relay=${encodeURIComponent(url)}`),
          "secret=x",
        ].join("&"),
      ),
    );
    expect(parsed?.relays).toEqual([
      "wss://r0.test",
      "wss://r1.test",
      "wss://r2.test",
      "wss://r3.test",
      "wss://r4.test",
    ]);
  });

  it.each([
    ["another scheme", `bunker://${client.pubkey}?${relay}&secret=x`],
    ["no wss relay", uri("relay=ws%3A%2F%2Frelay.test&secret=x")],
    ["no relay", uri("secret=x")],
    ["no secret", uri(relay)],
    ["an empty secret", uri(`${relay}&secret=`)],
    ["a short pubkey", uri(`${relay}&secret=x`, "abcd")],
    ["an off-curve pubkey", uri(`${relay}&secret=x`, "f".repeat(64))],
    ["garbage", "not a uri"],
  ])("rejects %s", (_, text) => {
    expect(parseNostrConnectUri(text)).toBeNull();
  });
});

const requestWith = (
  fields: Partial<{ perms: Array<string>; url: string | null }> = {},
) => {
  const parsed = parseNostrConnectUri(uri(`${relay}&secret=x`));
  assert(parsed !== null);
  return new NostrConnectRequest({ ...parsed, ...fields });
};

const rpc = (method: string, params: Array<string> = []) =>
  ({ id: "r1", method, params }) satisfies NostrConnectRpcRequest;

const signRequest = (template: object) =>
  rpc("sign_event", [JSON.stringify(template)]);

const nip98 = {
  kind: 27235,
  content: "",
  tags: [
    ["u", "https://PEAURLA.test/api/login"],
    ["method", "POST"],
  ],
  created_at: 1,
};

describe("answerNostrConnectRequest", () => {
  it("shares the identity pubkey", () => {
    expect(
      answerNostrConnectRequest(requestWith(), me, rpc("get_public_key"), now),
    ).toEqual({
      response: { id: "r1", result: me.pubkey },
      outcome: { _tag: "PublicKeyShared" },
    });
  });

  it("answers ping and connect, and errors on other methods without failing", () => {
    const answer = (method: string) =>
      answerNostrConnectRequest(requestWith(), me, rpc(method), now);
    expect(answer("ping").response).toEqual({ id: "r1", result: "pong" });
    expect(answer("connect").response).toEqual({ id: "r1", result: "ack" });
    expect(answer("nip44_decrypt")).toEqual({
      response: { id: "r1", error: "unsupported method nip44_decrypt" },
      outcome: { _tag: "Answered" },
    });
  });

  it("signs an allowed template as is, with created_at set to now", () => {
    const answer = answerNostrConnectRequest(
      requestWith({
        perms: ["sign_event:27235"],
        url: "https://peaurla.test/login",
      }),
      me,
      signRequest(nip98),
      now,
    );
    expect(answer.outcome).toEqual({ _tag: "Signed", kind: 27235 });
    assert("result" in answer.response);
    const event = Schema.decodeUnknownSync(Schema.parseJson(SignedPlainEvent))(
      answer.response.result,
    );
    expect(verifyEvent(event)).toBe(true);
    expect(event).toMatchObject({
      pubkey: me.pubkey,
      kind: 27235,
      content: "",
      tags: nip98.tags,
      created_at: now,
    });
  });

  it("signs NIP-42 auth under a plain sign_event perm and without a site url", () => {
    const answer = answerNostrConnectRequest(
      requestWith({ perms: ["sign_event"] }),
      me,
      signRequest({
        kind: 22242,
        content: "",
        tags: [
          ["relay", "wss://relay.test"],
          ["challenge", "c"],
        ],
      }),
      now,
    );
    expect(answer.outcome).toEqual({ _tag: "Signed", kind: 22242 });
  });

  it.each([
    ["a disallowed kind", {}, { ...nip98, kind: 1 }, "kind 1 is not allowed"],
    [
      "a kind outside the perms",
      { perms: ["sign_event:22242"] },
      nip98,
      "sign_event:27235 was not requested",
    ],
    [
      "a u tag for another site",
      { url: "https://evil.test" },
      nip98,
      "u tag does not match the site",
    ],
    [
      "a second u tag for another site",
      { url: "https://peaurla.test" },
      {
        ...nip98,
        tags: [...nip98.tags, ["u", "https://evil.test/api"]],
      },
      "u tag does not match the site",
    ],
    ["a malformed template", {}, { kind: 27235 }, "invalid event template"],
  ])("refuses %s", (_, fields, template, reason) => {
    expect(
      answerNostrConnectRequest(
        requestWith(fields),
        me,
        signRequest(template),
        now,
      ),
    ).toEqual({
      response: { id: "r1", error: reason },
      outcome: { _tag: "Refused", reason },
    });
  });
});

const signer = openNostrConnectChannel(me, client.pubkey);

const clientEvent = (content: string, author = client) =>
  finalizeEvent(
    {
      kind: 24133,
      tags: [["p", me.pubkey]],
      content,
      created_at: now,
    },
    author.secretKey,
  );

const encrypted = (payload: object, author = client) =>
  encrypt(
    JSON.stringify(payload),
    getConversationKey(author.secretKey, me.pubkey),
  );

describe("decodeNostrConnectRequest", () => {
  it("decrypts a client request", () => {
    const event = clientEvent(encrypted({ id: "r1", method: "ping" }));
    expect(decodeNostrConnectRequest(signer, event)).toEqual({
      eventId: event.id,
      rpc: { id: "r1", method: "ping", params: [] },
    });
  });

  it("reads its own replies back on the client side", () => {
    const reply = encodeNostrConnectEvent(
      signer,
      { id: "r1", result: "pong" },
      now,
    );
    expect(reply.tags).toEqual([["p", client.pubkey]]);
    expect(
      JSON.parse(
        decrypt(reply.content, getConversationKey(client.secretKey, me.pubkey)),
      ),
    ).toEqual({ id: "r1", result: "pong" });
  });

  it.each([
    [
      "another author",
      () => {
        const stranger = makeIdentity();
        return clientEvent(
          encrypted({ id: "r1", method: "ping" }, stranger),
          stranger,
        );
      },
    ],
    ["NIP-04 content", () => clientEvent("Zm9v?iv=YmFy")],
    ["a payload without a method", () => clientEvent(encrypted({ id: "r1" }))],
    [
      "a forged signature",
      () => ({
        ...clientEvent(encrypted({ id: "r1", method: "ping" })),
        sig: "0".repeat(128),
      }),
    ],
  ])("ignores %s", (_, event) => {
    expect(decodeNostrConnectRequest(signer, event())).toBeNull();
  });
});
