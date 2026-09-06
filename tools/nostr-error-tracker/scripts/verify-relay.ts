import assert from "node:assert/strict";
import { Effect, Schema } from "effect";
import { createSlip39Share } from "@linky/identity";
import { finalizeEvent, generateSecretKey, type Event } from "nostr-tools";
import { wrapEvent } from "nostr-tools/nip59";
import { loginWithSecret } from "../src/auth";
import { fetchReports } from "../src/inbox";

const session = await loginWithSecret(
  await Effect.runPromise(createSlip39Share()),
);
const pubkey = session.pubkey;
const sender = generateSecretKey();
const now = Math.floor(Date.now() / 1000);
const reportWrap = wrapEvent(
  {
    kind: 24134,
    tags: [["p", pubkey]],
    content: JSON.stringify({
      v: 1,
      id: "local-relay-fixture",
      createdAtSec: now,
      direction: "out",
      status: "error",
      method: "lightning_invoice",
      phase: "melt",
      appVersion: "26.9.1",
      errorCode: "mint_failed",
    }),
  },
  sender,
  pubkey,
);

// 501 valid, unrelated wraps at one timestamp force inclusive pagination growth.
const events: Event[] = Array.from({ length: 501 }, (_, index) =>
  finalizeEvent(
    {
      kind: 1059,
      tags: [["p", pubkey]],
      content: `synthetic-unreadable-${index}`,
      created_at: now,
    },
    sender,
  ),
);
events.push(reportWrap);
const Request = Schema.parseJson(
  Schema.Tuple(
    Schema.Literal("REQ"),
    Schema.String,
    Schema.Struct({
      kinds: Schema.Array(Schema.Number),
      until: Schema.optional(Schema.Number),
      limit: Schema.optional(Schema.Number),
    }),
  ),
);
let queries = 0;
let publishes = 0;
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request, server) {
    if (server.upgrade(request)) return;
    return new Response("fixture", { status: 400 });
  },
  websocket: {
    message(socket, raw) {
      const text = raw.toString();
      if (text.startsWith('["EVENT"')) publishes++;
      const decoded = Schema.decodeUnknownOption(Request)(text);
      if (decoded._tag === "None") return;
      const [, id, filter] = decoded.value;
      queries++;
      const selected = events
        .filter(
          (event) =>
            filter.kinds.includes(event.kind) &&
            (filter.until === undefined || event.created_at <= filter.until),
        )
        .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))
        .slice(0, filter.limit);
      for (const event of selected)
        socket.send(JSON.stringify(["EVENT", id, event]));
      socket.send(JSON.stringify(["EOSE", id]));
    },
  },
});

try {
  const result = await fetchReports(session, {
    relays: [`ws://127.0.0.1:${server.port}`],
    signal: new AbortController().signal,
    onProgress: () => {},
  });
  assert.equal(result.scanned, 502);
  assert.equal(result.ignored, 501);
  assert.equal(result.reports.length, 1);
  assert.equal(result.reports[0]?.appVersion, "26.9.1");
  assert.equal(result.relays[0]?.complete, true);
  assert.ok(queries >= 4);
  assert.equal(publishes, 0);
  session.dispose();
  console.log(
    "Local relay passed: 502 wraps, same-timestamp pagination, one decrypted error, zero published events.",
  );
} finally {
  await server.stop(true);
  session.dispose();
  sender.fill(0);
}
