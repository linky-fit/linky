import assert from "node:assert/strict";
import { once } from "node:events";
import { Effect, Schema } from "effect";
import { WebSocketServer } from "ws";
import {
  NostrTransport,
  RelayUrl,
  makeNostrTransportSimplePool,
} from "@linky-fit/linkstr";

const requestSchema = Schema.Tuple(
  Schema.Literal("REQ"),
  Schema.String,
  Schema.Struct({
    ids: Schema.optional(Schema.Array(Schema.String)),
    limit: Schema.optional(Schema.Number),
  }),
);
const decodeRequest = Schema.decodeUnknownOption(
  Schema.parseJson(requestSchema),
);
const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
await once(server, "listening");
const address = server.address();
if (!address || typeof address === "string") throw new Error("No relay port");
let connections = 0;
let pings = 0;
const healthy = Promise.withResolvers();
server.on("connection", (socket) => {
  connections++;
  socket.on("message", (data) => {
    const decoded = decodeRequest(data.toString());
    if (decoded._tag === "None") return;
    const [, id, filter] = decoded.value;
    if (filter.ids?.[0] === "a".repeat(64)) {
      if (filter.limit !== 1) {
        healthy.reject(new Error("Keepalive must request limit: 1"));
        return;
      }
      pings++;
      if (pings === 2) healthy.resolve();
    }
    socket.send(JSON.stringify(["EOSE", id]));
  });
});

try {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const transport = yield* NostrTransport;
        yield* Effect.forkScoped(
          transport.subscribe(
            RelayUrl.make(`ws://127.0.0.1:${address.port}`),
            { kinds: [1] },
            () => {},
          ),
        );
        yield* Effect.tryPromise(() => healthy.promise);
      }).pipe(
        Effect.provide(
          makeNostrTransportSimplePool({ allowInsecureLocalhost: true }),
        ),
        Effect.timeout("70 seconds"),
      ),
    ),
  );
  assert.equal(connections, 1, "Healthy relay reconnected between keepalives");
  assert.equal(pings, 2);
  console.log(
    "Packed linkstr: two real WebSocket keepalives used limit: 1 on one connection",
  );
} finally {
  for (const client of server.clients) client.terminate();
  await new Promise((resolve) => server.close(resolve));
}
