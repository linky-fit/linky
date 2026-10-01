import {
  authTemplate,
  createNonce,
  LINKAUTH_PERMISSION,
} from "@linky-fit/linkauth";
import { finalizeEvent, verifyEvent } from "nostr-tools";
import { decrypt, encrypt, getConversationKey } from "nostr-tools/nip44";
import { Schema } from "effect";
import { RelayUrl, UnixSeconds } from "../domain/primitives";
import { SignedPlainEvent } from "../internal/nostrEvent";
import { makeIdentity } from "../testing";
import {
  answerNostrConnectRequest,
  decodeNostrConnectRequest,
  DEVICE_AUTHORIZATION_PERMISSION,
  deviceAuthorizationTemplate,
  linkauthAudience,
  verifyDeviceAuthorization,
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
          `perms=${encodeURIComponent("sign_event:24139, nip44_encrypt")}`,
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
        perms: ["sign_event:24139", "nip44_encrypt"],
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
  fields: Partial<{
    perms: Array<string>;
    url: string | null;
    name: string | null;
  }> = {},
) => {
  const parsed = parseNostrConnectUri(uri(`${relay}&secret=x`));
  assert(parsed !== null);
  return new NostrConnectRequest({ ...parsed, ...fields });
};

const rpc = (method: string, params: Array<string> = []) =>
  ({ id: "r1", method, params }) satisfies NostrConnectRpcRequest;

const signRequest = (template: object) =>
  rpc("sign_event", [JSON.stringify(template)]);

const SITE = "https://peaurla.test";
const loginTemplate = (audience = SITE) =>
  authTemplate({ audience, nonce: createNonce() });
const allowedLogin = { perms: [LINKAUTH_PERMISSION], url: `${SITE}/login` };

const nip98 = {
  kind: 27235,
  content: "",
  tags: [
    ["u", "https://npub.linky.fit/api/wallet"],
    ["method", "POST"],
  ],
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

  it("signs the canonical login for the link's origin, with created_at set to now", () => {
    const template = loginTemplate();
    const answer = answerNostrConnectRequest(
      requestWith(allowedLogin),
      me,
      signRequest(template),
      now,
    );
    expect(answer.outcome).toEqual({
      _tag: "Signed",
      kind: 24139,
      device: null,
    });
    assert("result" in answer.response);
    const event = Schema.decodeUnknownSync(
      Schema.fromJsonString(SignedPlainEvent),
    )(answer.response.result);
    expect(verifyEvent(event)).toBe(true);
    expect(event).toMatchObject({
      pubkey: me.pubkey,
      ...template,
      created_at: now,
    });
  });

  it.each([
    ["no perms", { ...allowedLogin, perms: [] }, "sign_event:24139"],
    [
      "a blanket sign_event",
      { ...allowedLogin, perms: ["sign_event"] },
      "sign_event:24139",
    ],
    [
      "another kind's permission",
      { ...allowedLogin, perms: ["sign_event:27235"] },
      "sign_event:24139",
    ],
    ["no url", { ...allowedLogin, url: null }, "needs the site's url"],
    [
      "an unacceptable url",
      { ...allowedLogin, url: "http://peaurla.test" },
      "needs the site's url",
    ],
    [
      "a template for another origin",
      { ...allowedLogin, url: "https://evil.test" },
      "invalid login template",
    ],
  ])("refuses a login with %s", (_, fields, reason) => {
    const answer = answerNostrConnectRequest(
      requestWith(fields),
      me,
      signRequest(loginTemplate()),
      now,
    );
    assert("error" in answer.response);
    expect(answer.response.error).toContain(reason);
    expect(answer.outcome._tag).toBe("Refused");
  });

  it.each([
    [
      "extra tags",
      { ...loginTemplate(), tags: [...loginTemplate().tags, ["u", "x"]] },
    ],
    ["other content", { ...loginTemplate(), content: "pay me" }],
    ["a non-canonical audience", loginTemplate(`${SITE}/path`)],
  ])("refuses a login template with %s", (_, template) => {
    const answer = answerNostrConnectRequest(
      requestWith(allowedLogin),
      me,
      signRequest(template),
      now,
    );
    expect(answer.response).toEqual({
      id: "r1",
      error: "invalid login template",
    });
  });

  // #546: a site must not obtain a credential for the user's wallet backend.
  it.each([
    ["with its url and perms", allowedLogin],
    ["with perms only", { perms: [LINKAUTH_PERMISSION] }],
    ["with its url only", { perms: [], url: SITE }],
    ["with a blanket sign_event", { perms: ["sign_event"], url: SITE }],
    [
      "with the NIP-98 permission",
      { perms: ["sign_event:27235"], url: "https://npub.linky.fit" },
    ],
    ["with no link fields", {}],
  ])("never signs a NIP-98 event for the wallet backend %s", (_, fields) => {
    expect(
      answerNostrConnectRequest(
        requestWith(fields),
        me,
        signRequest(nip98),
        now,
      ),
    ).toEqual({
      response: { id: "r1", error: "kind 27235 is not allowed" },
      outcome: { _tag: "Refused", reason: "kind 27235 is not allowed" },
    });
  });

  it.each([
    [
      "a NIP-42 event",
      { kind: 22242, content: "", tags: [["challenge", "c"]] },
    ],
    ["a note", { kind: 1, content: "hi", tags: [] }],
    ["a malformed template", { kind: 24139 }],
  ])("refuses %s", (_, template) => {
    expect(
      answerNostrConnectRequest(
        requestWith(allowedLogin),
        me,
        signRequest(template),
        now,
      ).outcome._tag,
    ).toBe("Refused");
  });
});

describe("linkauthAudience", () => {
  it.each([
    ["the explicit permission and an https url", allowedLogin, SITE],
    [
      "a localhost url",
      { ...allowedLogin, url: "http://localhost:3000/x" },
      "http://localhost:3000",
    ],
    ["a bare sign_event", { ...allowedLogin, perms: ["sign_event"] }, null],
    ["no url", { ...allowedLogin, url: null }, null],
    ["a plain http url", { ...allowedLogin, url: "http://peaurla.test" }, null],
  ])("reads %s", (_, fields, audience) => {
    expect(linkauthAudience(requestWith(fields))).toBe(audience);
  });
});

describe("device authorization signing", () => {
  const device = makeIdentity();
  const app = "Platit prosím";
  const authorization = deviceAuthorizationTemplate({
    device: device.pubkey,
    app,
  });
  const allowed = { perms: [DEVICE_AUTHORIZATION_PERMISSION], name: app };

  it("signs the canonical template under its explicit permission and the approved name", () => {
    const answer = answerNostrConnectRequest(
      requestWith(allowed),
      me,
      signRequest(authorization),
      now,
    );
    expect(answer.outcome).toEqual({
      _tag: "Signed",
      kind: 24138,
      device: device.pubkey,
    });
    assert("result" in answer.response);
    expect(verifyDeviceAuthorization(answer.response.result)).toMatchObject({
      author: me.pubkey,
      device: device.pubkey,
      app,
      createdAt: now,
    });
  });

  it.each([
    ["no perms", { name: app, perms: [] }, authorization],
    [
      "a blanket sign_event",
      { name: app, perms: ["sign_event"] },
      authorization,
    ],
    [
      "no app name",
      { perms: [DEVICE_AUTHORIZATION_PERMISSION] },
      authorization,
    ],
    [
      "another app's name",
      allowed,
      deviceAuthorizationTemplate({ device: device.pubkey, app: "Other" }),
    ],
    ["hidden content", allowed, { ...authorization, content: "pay me" }],
    [
      "an extra tag",
      allowed,
      { ...authorization, tags: [...authorization.tags, ["u", "x"]] },
    ],
  ])("refuses it with %s", (_, fields, template) => {
    const answer = answerNostrConnectRequest(
      requestWith(fields),
      me,
      signRequest(template),
      now,
    );
    expect(answer.outcome._tag).toBe("Refused");
  });

  it("rejects a forged or reshaped authorization", () => {
    const answer = answerNostrConnectRequest(
      requestWith(allowed),
      me,
      signRequest(authorization),
      now,
    );
    assert("result" in answer.response);
    const event = JSON.parse(answer.response.result);
    expect(
      verifyDeviceAuthorization({ ...event, sig: "00".repeat(64) }),
    ).toBeNull();
    expect(
      verifyDeviceAuthorization(
        finalizeEvent(
          { ...authorization, content: "x", created_at: now },
          me.secretKey,
        ),
      ),
    ).toBeNull();
    expect(verifyDeviceAuthorization("not json")).toBeNull();
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
