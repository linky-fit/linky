import {
  boltCardId,
  encodeCardMessage,
  issueBoltCardTap,
} from "@linky-fit/bolt-card";
import { describe, expect, test } from "bun:test";
import { loadConfig } from "./config";
import { consoleDebugLog } from "./debugLog";
import { createHttpHandler } from "./http";
import { InMemoryRateLimiter } from "./requestSecurity";
import { CardSessions } from "./sessions";
import {
  authMessage,
  FakeSocket,
  newCard,
  sessionOptions,
} from "./testSupport";

const k1 = "7f".repeat(32);
const invoice = `lnbc20u1${"q".repeat(300)}`;

/** Runs one tap and its callback with every debug line captured. */
const tapWithLogs = async () => {
  const lines: string[] = [];
  const log = consoleDebugLog((line) => lines.push(line));
  const config = loadConfig({
    BOLT_CARD_BRIDGE_PUBLIC_URL: "https://bridge.example",
  });
  const sessions = new CardSessions(sessionOptions({ log }));
  const handle = createHttpHandler({
    config,
    sessions,
    rateLimiter: new InMemoryRateLimiter(),
    log,
  });

  const card = newCard();
  const socket = new FakeSocket();
  socket.onSend = (message) => {
    if (message._tag === "withdraw") {
      sessions.message(
        socket,
        encodeCardMessage({
          _tag: "offer",
          id: message.id,
          k1,
          minWithdrawable: 1_000,
          maxWithdrawable: 21_000,
          defaultDescription: "Linky",
        }),
      );
    }
    if (message._tag === "callback") {
      sessions.message(
        socket,
        encodeCardMessage({ _tag: "accepted", id: message.id }),
      );
    }
  };
  sessions.open(socket);
  const auth = authMessage(card, socket.challenge);
  sessions.message(socket, auth);

  const tap = issueBoltCardTap(card, "http://bridge");
  if (!tap) throw new Error("card exhausted");
  const context = { peerIp: "203.0.113.1", upgrade: () => false };
  await handle(new Request(tap.url), context);
  await handle(
    new Request(`http://bridge/cb/${boltCardId(card)}?k1=${k1}&pr=${invoice}`),
    context,
  );
  sessions.close(socket, 1000);

  const params = new URL(tap.url).searchParams;
  return {
    lines,
    secrets: {
      cardId: boltCardId(card),
      challenge: socket.challenge,
      signature: JSON.parse(auth).signature,
      p: params.get("p") ?? "",
      c: params.get("c") ?? "",
    },
  };
};

describe("debug log", () => {
  test("shows each message between POS, bridge and card in order", async () => {
    const { lines } = await tapWithLogs();
    const events = lines.map((line) => line.split(" ")[1]);
    expect(events).toEqual([
      "socket.open",
      "socket.authenticated",
      "pos.request",
      "card.send",
      "card.reply",
      "pos.response",
      "pos.request",
      "card.send",
      "card.reply",
      "pos.response",
      "socket.closed",
    ]);
    expect(lines[4]).toContain("tag=offer");
    expect(lines[4]).toContain("maxMsat=21000");
    expect(lines[5]).toContain("outcome=withdrawRequest");
    expect(lines[6]).toContain("pr=lnbc20u1qqqqqq…(308)");
    expect(lines[9]).toContain("outcome=OK");
    expect(lines[10]).toContain("code=1000");
  });

  test("never prints k1, signatures, challenges, whole invoices, card ids or card data", async () => {
    const { lines, secrets } = await tapWithLogs();
    const output = lines.join("\n");
    for (const secret of [
      k1,
      invoice,
      secrets.cardId,
      secrets.challenge,
      secrets.signature,
      secrets.p,
      secrets.c,
    ]) {
      expect(output).not.toContain(secret);
    }
    expect(output).not.toContain("203.0.113.1");
  });

  test("quotes values that would break the key=value format", () => {
    const lines: string[] = [];
    consoleDebugLog((line) => lines.push(line))("pos.response", {
      reason: 'Card is "not" active',
      empty: "",
      missing: undefined,
      ms: 3,
    });
    expect(lines).toEqual([
      '[bolt-card-bridge] pos.response reason="Card is \\"not\\" active" empty="" ms=3',
    ]);
  });
});
