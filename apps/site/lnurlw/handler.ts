import { createHash } from "node:crypto";
import {
  Chat,
  ClientId,
  MessageText,
  NostrSecretKey,
  RelayUrl,
  TextMessageDraft,
  UnixSeconds,
  WrapInbox,
  parseLnurlWithdrawBridgeReply,
  readLnurlWithdrawSession,
  runLinkstr,
} from "@linky-fit/linkstr";
import type { LnurlWithdrawBridgeRequest } from "@linky-fit/linkstr";
import { getPayableLightningInvoice } from "@linky-fit/linkshu";
import { Effect, Fiber, Option, Schema, Stream } from "effect";
import { nowSeconds } from "../../web-app/src/utils/time";
import recommendedRelays from "../public/recommended-relays.json";
import {
  getFirstQueryValue,
  getPublicOrigin,
  setJsonProxyHeaders,
} from "../api/_npubcash.js";
import type { ApiRequest, ApiResponse } from "../api/_npubcash.js";

const SESSION_BODY = Schema.Struct({ session: Schema.Unknown });
const TIMEOUT_MS = 12_000;
const allowedRelays = Schema.decodeUnknownSync(
  Schema.Struct({ nostr: Schema.Array(RelayUrl) }),
)(recommendedRelays).nostr.map((relay) => new URL(relay).toString());

const exchange = async (
  request: LnurlWithdrawBridgeRequest,
  relays: readonly RelayUrl[],
) => {
  const secretKey = NostrSecretKey.make(
    crypto.getRandomValues(new Uint8Array(32)),
  );
  return runLinkstr(
    { secretKey, readRelays: relays, writeRelays: relays },
    Effect.scoped(
      Effect.gen(function* () {
        const inbox = yield* WrapInbox;
        const feed = yield* inbox.open();
        const reply = yield* Stream.runHead(
          feed.events.pipe(
            Stream.filterMap(({ event }) => {
              if (
                event._tag !== "ChatMessageReceived" ||
                event.from !== request.session.pubkey ||
                event.body._tag !== "TextBody"
              )
                return Option.none();
              const value = parseLnurlWithdrawBridgeReply(event.body.text);
              return value !== null &&
                value.sessionId === request.session.id &&
                value.requestId === request.requestId
                ? Option.some(value)
                : Option.none();
            }),
          ),
        ).pipe(Effect.forkScoped);
        const chat = yield* Chat;
        yield* chat.sendText(
          new TextMessageDraft({
            to: request.session.pubkey,
            content: MessageText.make(JSON.stringify(request)),
          }),
        );
        const result = yield* Fiber.join(reply);
        if (Option.isNone(result))
          return yield* Effect.fail(new Error("Wallet reply unavailable"));
        return result.value;
      }),
    ).pipe(
      Effect.timeoutFail({
        duration: TIMEOUT_MS,
        onTimeout: () =>
          new Error(
            "Wallet reply timed out; a submitted payment may still complete",
          ),
      }),
    ),
  );
};

export default async function handler(
  req: ApiRequest & { body?: unknown },
  res: ApiResponse,
) {
  setJsonProxyHeaders(res);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
  try {
    const apiUrl = `${getPublicOrigin(req)}/api/lnurlw`;
    const token = getFirstQueryValue(req.query?.session);
    if (req.method === "GET" && token === null) {
      res
        .status(200)
        .json({ apiUrl, allowedRelays, maxSessionSeconds: 120, mode: "poc" });
      return;
    }
    if (req.method !== "GET" && req.method !== "POST") {
      res.setHeader("Allow", "GET, POST, OPTIONS");
      res.status(405).json({ status: "ERROR", reason: "Use GET or POST" });
      return;
    }
    if (token !== null && token.length > 8_000)
      throw new Error("Session token too large");
    const input: unknown =
      req.method === "POST"
        ? Schema.decodeUnknownSync(SESSION_BODY)(req.body).session
        : JSON.parse(Buffer.from(token ?? "", "base64url").toString("utf8"));
    const { session, options } = readLnurlWithdrawSession(
      input,
      UnixSeconds.make(nowSeconds()),
    );
    if (options.apiUrl !== apiUrl)
      throw new Error("Session belongs to another API origin");
    if (
      options.relays.some(
        (relay) => !allowedRelays.includes(new URL(relay).toString()),
      )
    ) {
      throw new Error(
        "Relay is outside the PoC egress allowlist; GET /api/lnurlw lists permitted candidates",
      );
    }
    const sessionToken = Buffer.from(JSON.stringify(session)).toString(
      "base64url",
    );
    const url = `${apiUrl}?session=${sessionToken}`;
    const deadline = UnixSeconds.make(
      Math.min(options.expiresAtSec, nowSeconds() + TIMEOUT_MS / 1000),
    );
    if (req.method === "POST") {
      const relayResults = await Promise.all(
        options.relays.map(async (relay) => {
          try {
            const reply = await exchange(
              {
                type: "linky.lnurlw.probe",
                session,
                requestId: ClientId.make(crypto.randomUUID()),
                deadline,
              },
              [relay],
            );
            return {
              relay,
              compatible: reply.status === "ready",
              reason:
                reply.reason ??
                (reply.status === "ready"
                  ? "Encrypted round trip succeeded"
                  : "Wallet rejected the probe"),
            };
          } catch {
            return {
              relay,
              compatible: false,
              reason:
                "No encrypted round trip; relay may be unreachable, restricted or require authentication",
            };
          }
        }),
      );
      if (!relayResults.some((result) => result.compatible)) {
        res.status(422).json({
          status: "ERROR",
          reason: "No compatible relay reached the wallet",
          relayResults,
        });
        return;
      }
      res.status(200).json({
        url,
        lnurl: url.replace(/^https?:\/\//, "lnurlw://"),
        expiresAtSec: options.expiresAtSec,
        relayResults,
      });
      return;
    }
    const invoice = getFirstQueryValue(req.query?.pr);
    const k1 = getFirstQueryValue(req.query?.k1);
    if (invoice === null && k1 === null) {
      res.status(200).json({
        tag: "withdrawRequest",
        callback: url,
        k1: session.id,
        defaultDescription: "Linky API PoC",
        minWithdrawable: 1000,
        maxWithdrawable: options.maxAmountSat * 1000,
      });
      return;
    }
    if (k1 !== session.id || invoice === null)
      throw new Error("Invalid callback challenge or invoice");
    const preview = getPayableLightningInvoice(invoice);
    if (
      preview === null ||
      preview.amountSat > options.maxAmountSat ||
      preview.expiresAtSec <= nowSeconds()
    ) {
      throw new Error(
        "Invoice is invalid, expired or exceeds the session amount limit",
      );
    }
    const requestId = ClientId.make(
      createHash("sha256").update(`${session.id}:${invoice}`).digest("hex"),
    );
    const reply = await exchange(
      { type: "linky.lnurlw.pay", session, requestId, deadline, invoice },
      options.relays,
    );
    if (reply.status !== "accepted") {
      res.status(200).json({
        status: "ERROR",
        reason: reply.reason ?? "Wallet rejected the payment",
      });
      return;
    }
    res.status(200).json({ status: "OK" });
  } catch (error) {
    res.status(400).json({
      status: "ERROR",
      reason: error instanceof Error ? error.message : "LNURLw request failed",
    });
  }
}
