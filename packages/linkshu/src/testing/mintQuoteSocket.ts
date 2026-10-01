import { once } from "node:events";
import { Schema } from "effect";
import { WebSocketServer } from "ws";
import { MintUrl } from "../domain/primitives";

const decodeRequest = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Union([
      Schema.Struct({
        id: Schema.Number,
        method: Schema.Literal("subscribe"),
        params: Schema.Struct({
          subId: Schema.String,
          kind: Schema.Literal("bolt11_mint_quote"),
          filters: Schema.Array(Schema.String),
        }),
      }),
      Schema.Struct({
        id: Schema.Number,
        method: Schema.Literal("unsubscribe"),
        params: Schema.Struct({ subId: Schema.String }),
      }),
    ]),
  ),
);

/** Real NUT-17 transport with manually controlled quote states and disconnects. */
export const mintQuoteSocket = async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  const states = new Map<string, "PAID" | "ISSUED">();
  const subscribedQuotes: string[] = [];
  const pendingReplays: Array<() => void> = [];
  let replaysPaused = false;
  let connections = 0;
  server.on("connection", (socket) => {
    connections += 1;
    socket.on("message", (data) => {
      const request = decodeRequest(data.toString());
      socket.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          result: { status: "OK", subId: request.params.subId },
        }),
      );
      if (request.method !== "subscribe") return;
      for (const quote of request.params.filters) {
        subscribedQuotes.push(quote);
        const replay = () =>
          socket.send(
            JSON.stringify({
              jsonrpc: "2.0",
              method: "subscribe",
              params: {
                subId: request.params.subId,
                payload: {
                  quote,
                  request: "lnbc160n1pexampleinvoice",
                  unit: "sat",
                  amount: 16,
                  expiry: null,
                  state: states.get(quote) ?? "UNPAID",
                },
              },
            }),
          );
        if (replaysPaused) pendingReplays.push(replay);
        else replay();
      }
    });
  });
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected a TCP websocket listener");
  }
  const disconnect = () => {
    for (const socket of server.clients) socket.terminate();
  };
  return {
    mint: MintUrl.make(`http://127.0.0.1:${address.port}`),
    states,
    subscribedQuotes,
    pauseReplays: () => {
      replaysPaused = true;
    },
    resumeReplays: () => {
      replaysPaused = false;
      for (const replay of pendingReplays.splice(0)) replay();
    },
    get connections() {
      return connections;
    },
    get openConnections() {
      return server.clients.size;
    },
    disconnect,
    close: () => {
      disconnect();
      return new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
};
