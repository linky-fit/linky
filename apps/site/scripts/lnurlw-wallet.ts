import {
  Chat,
  MessageText,
  NostrSecretKey,
  RelayUrl,
  TextMessageDraft,
  UnixSeconds,
  WrapInbox,
  makeLnurlWithdrawSession,
  parseLnurlWithdrawBridgeRequest,
  readLnurlWithdrawSession,
  runLinkstr,
} from "@linky-fit/linkstr";
import { Effect, Stream } from "effect";
import { nowSeconds } from "../../web-app/src/utils/time";

const [baseUrl, ...relayArgs] = process.argv.slice(2);
if (!baseUrl || relayArgs.length === 0)
  throw new Error(
    "Usage: bun apps/site/scripts/lnurlw-wallet.ts <preview-origin> <relay> [relay...]",
  );
const apiUrl = new URL("/api/lnurlw", baseUrl).toString();
const relays = relayArgs.map((relay) => RelayUrl.make(relay));
const secretKey = NostrSecretKey.make(
  crypto.getRandomValues(new Uint8Array(32)),
);
const now = UnixSeconds.make(nowSeconds());
const session = makeLnurlWithdrawSession(
  {
    apiUrl,
    relays,
    maxAmountSat: 1000,
    maxFeeSat: 10,
    expiresAtSec: UnixSeconds.make(now + 120),
  },
  secretKey,
  now,
);
let acceptedInvoice: string | null = null;

await runLinkstr(
  { secretKey, readRelays: relays, writeRelays: relays },
  Effect.scoped(
    Effect.gen(function* () {
      const inbox = yield* WrapInbox;
      const feed = yield* inbox.open();
      const chat = yield* Chat;
      yield* Stream.runForEach(feed.events, ({ event }) =>
        Effect.gen(function* () {
          if (
            event._tag !== "ChatMessageReceived" ||
            event.body._tag !== "TextBody"
          )
            return;
          const request = parseLnurlWithdrawBridgeRequest(event.body.text);
          if (
            request === null ||
            request.session.id !== session.id ||
            request.deadline <= nowSeconds()
          )
            return;
          readLnurlWithdrawSession(
            request.session,
            UnixSeconds.make(nowSeconds()),
          );
          let status: "ready" | "accepted" | "rejected" = "ready";
          if (request.type === "linky.lnurlw.pay") {
            if (acceptedInvoice !== null && acceptedInvoice !== request.invoice)
              status = "rejected";
            else {
              acceptedInvoice = request.invoice;
              status = "accepted";
            }
            console.log(`Simulated wallet: ${status}. No funds moved.`);
          }
          yield* chat.sendText(
            new TextMessageDraft({
              to: event.from,
              content: MessageText.make(
                JSON.stringify({
                  type: "linky.lnurlw.reply",
                  sessionId: session.id,
                  requestId: request.requestId,
                  status,
                  ...(status === "rejected"
                    ? { reason: "Session already bound to another invoice" }
                    : {}),
                }),
              ),
            }),
          );
        }),
      ).pipe(Effect.forkScoped);
      yield* Effect.tryPromise(async () => {
        const response = await fetch(apiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session }),
        });
        console.log(await response.text());
        if (!response.ok)
          throw new Error(
            `Session preparation failed: HTTP ${response.status}`,
          );
      });
      console.log(
        "Wallet simulator listening until session expiry. This example never pays invoices.",
      );
      yield* Effect.sleep(
        `${Math.max(0, session.created_at + 120 - nowSeconds())} seconds`,
      );
    }),
  ),
);
