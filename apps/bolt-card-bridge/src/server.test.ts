import {
  boltCardId,
  decodeBridgeMessage,
  encodeCardMessage,
  issueBoltCardTap,
  type BoltCard,
  type BridgeMessage,
  type CardMessage,
} from "@linky-fit/bolt-card";
import { afterEach, describe, expect, test } from "bun:test";
import { loadConfig } from "./config";
import {
  MAX_SOCKET_MESSAGE_BYTES,
  startBridgeServer,
  type BridgeServer,
} from "./server";
import { CloseCode } from "./sessions";
import { authMessage, newCard } from "./testSupport";

// These tests run the real Bun server and real sockets, which the handler
// and session tests replace with fakes.

let bridge: BridgeServer | null = null;

afterEach(async () => {
  await bridge?.stop();
  bridge = null;
});

const start = (
  requestTimeoutMs = 2_000,
  debug = "0",
  write?: (line: string) => void,
) => {
  bridge = startBridgeServer(
    {
      ...loadConfig({
        BOLT_CARD_BRIDGE_PUBLIC_URL: "https://bridge.example",
        BOLT_CARD_BRIDGE_REQUEST_TIMEOUT_MS: String(requestTimeoutMs),
        BOLT_CARD_BRIDGE_DEBUG: debug,
      }),
      port: 0,
    },
    write ? { write } : {},
  );
  return `127.0.0.1:${bridge.port}`;
};

/** One tap and callback against a server in the given debug mode. */
const tapWithDebug = async (debug: string) => {
  const lines: string[] = [];
  const host = start(2_000, debug, (line) => lines.push(line));
  const card = newCard();
  const { socket, closed } = await connectCard(host, card, offerFor);
  const tap = issueBoltCardTap(card, `http://${host}`);
  if (!tap) throw new Error("card exhausted");
  await fetch(tap.url);
  const callbackUrl = `http://${host}/cb/${boltCardId(card)}?k1=${"22".repeat(32)}&pr=lnbc1raw`;
  await fetch(callbackUrl);
  socket.close(1000, "done");
  await closed;
  await Bun.sleep(20);
  return { lines, tapUrl: tap.url, callbackUrl };
};

interface CardClient {
  readonly socket: WebSocket;
  readonly closed: Promise<number>;
}

/** A device that authenticates and answers forwarded requests with `answer`. */
const connectCard = (
  host: string,
  card: BoltCard,
  answer: (message: BridgeMessage, socket: WebSocket) => CardMessage | null,
  sendAuth: (socket: WebSocket, auth: string) => void = (socket, auth) =>
    socket.send(auth),
): Promise<CardClient> => {
  const socket = new WebSocket(`ws://${host}/session`);
  const closed = new Promise<number>((resolve) => {
    socket.addEventListener("close", (event) => resolve(event.code));
  });
  return new Promise((resolve, reject) => {
    socket.addEventListener("message", (event) => {
      const message = decodeBridgeMessage(String(event.data));
      if (message?._tag === "challenge") {
        sendAuth(socket, authMessage(card, message.challenge));
      } else if (message?._tag === "ready") {
        resolve({ socket, closed });
      } else if (message) {
        const reply = answer(message, socket);
        if (reply) socket.send(encodeCardMessage(reply));
      }
    });
    void closed.then((code) => reject(new Error(`closed with ${code}`)));
  });
};

const offerFor = (message: BridgeMessage): CardMessage | null => {
  if (message._tag === "withdraw") {
    return {
      _tag: "offer",
      id: message.id,
      k1: "22".repeat(32),
      minWithdrawable: 1_000,
      maxWithdrawable: 5_000,
      defaultDescription: "Linky",
    };
  }
  if (message._tag === "callback") return { _tag: "accepted", id: message.id };
  return null;
};

describe("bridge server", () => {
  test("relays a real tap URL and its callback over a real socket", async () => {
    const host = start();
    const card = newCard();
    const { socket } = await connectCard(host, card, offerFor);

    const tap = issueBoltCardTap(card, `http://${host}`);
    if (!tap) throw new Error("card exhausted");
    const withdraw = await (await fetch(tap.url)).json();
    expect(withdraw).toMatchObject({
      tag: "withdrawRequest",
      callback: `https://bridge.example/cb/${boltCardId(card)}`,
      maxWithdrawable: 5_000,
    });

    const callback = await fetch(
      `http://${host}/cb/${boltCardId(card)}?k1=${"22".repeat(32)}&pr=lnbc1x`,
    );
    expect(await callback.json()).toEqual({ status: "OK" });
    socket.close();
  });

  test("accepts the authentication as a binary frame", async () => {
    const host = start();
    const { socket } = await connectCard(host, newCard(), offerFor, (s, auth) =>
      s.send(new TextEncoder().encode(auth)),
    );
    expect(bridge?.sessions.activeCards).toBe(1);
    socket.close();
  });

  test("closes a socket with a wrong signature", async () => {
    const host = start();
    const card = newCard();
    const attempt = connectCard(host, card, offerFor, (socket, auth) =>
      socket.send(auth.replace(/"signature":"../, '"signature":"00')),
    );
    await expect(attempt).rejects.toThrow(
      `closed with ${CloseCode.invalidAuth}`,
    );
    expect(bridge?.sessions.activeCards).toBe(0);
  });

  test("closes a socket that sends more than a card ever would", async () => {
    const host = start();
    const { socket, closed } = await connectCard(host, newCard(), offerFor);
    socket.send("x".repeat(MAX_SOCKET_MESSAGE_BYTES + 1));
    // Bun aborts the connection (1006) rather than closing it with 1009.
    expect(await closed).not.toBe(1000);
    await Bun.sleep(20);
    expect(bridge?.sessions.activeCards).toBe(0);
  });

  test("tells the POS at once when the card drops mid-request", async () => {
    const host = start(5_000);
    const card = newCard();
    await connectCard(host, card, (message, socket) => {
      if (message._tag === "withdraw") socket.close();
      return null;
    });
    const startedAt = Date.now();
    const tap = issueBoltCardTap(card, `http://${host}`);
    if (!tap) throw new Error("card exhausted");
    expect(await (await fetch(tap.url)).json()).toEqual({
      status: "ERROR",
      reason: "Card is not active",
    });
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });

  test("refuses a plain request to the session endpoint and serves health", async () => {
    const host = start();
    expect((await fetch(`http://${host}/session`)).status).toBe(426);
    expect(await (await fetch(`http://${host}/health`)).json()).toEqual({
      ok: true,
    });
  });

  test("raw debug logs show every request, response and frame verbatim", async () => {
    const { lines, tapUrl, callbackUrl } = await tapWithDebug("raw");
    const find = (event: string, text: string) =>
      lines.find((line) => line.includes(` ${event} `) && line.includes(text));

    expect(find("http.in", "upgrade=websocket")).toBeDefined();
    expect(find("http.upgraded", "connection=1")).toBeDefined();
    expect(find("ws.out", "challenge")).toBeDefined();
    expect(find("ws.in", "signature")).toBeDefined();
    expect(find("http.in", tapUrl)).toBeDefined();
    expect(
      find("ws.out", new URL(tapUrl).searchParams.get("p") ?? ""),
    ).toBeDefined();
    // The withdrawRequest body, k1 included, as the POS received it.
    expect(find("http.out", "22".repeat(32))).toContain("withdrawRequest");
    expect(find("http.in", callbackUrl)).toBeDefined();
    expect(find("ws.in", "accepted")).toBeDefined();
    expect(find("ws.close", "code=1000")).toContain("reason=done");
  });

  test("redacted debug logs keep the raw traffic out", async () => {
    const { lines } = await tapWithDebug("1");
    expect(lines.some((line) => line.includes(" pos.response "))).toBe(true);
    expect(lines.filter((line) => / (http|ws)\./.test(line))).toEqual([]);
    expect(lines.join("\n")).not.toContain("22".repeat(32));
  });

  test("a POS that reads the card before the phone connects still gets the offer", async () => {
    const host = start();
    const card = newCard();
    const tap = issueBoltCardTap(card, `http://${host}`);
    if (!tap) throw new Error("card exhausted");
    const withdraw = fetch(tap.url).then((response) => response.json());
    await Bun.sleep(200);
    const { socket } = await connectCard(host, card, offerFor);
    expect(await withdraw).toMatchObject({ tag: "withdrawRequest" });
    socket.close();
  });
});
