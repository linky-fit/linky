import { boltCardId, encodeCardMessage } from "@linky-fit/bolt-card";
import { describe, expect, test } from "bun:test";
import { CardSessions, CloseCode } from "./sessions";
import {
  authMessage,
  FakeSocket,
  newCard,
  sessionOptions,
} from "./testSupport";

const sessionsFor = (authTimeoutMs = 1_000, maxSessionMs = 10_000) =>
  new CardSessions(sessionOptions({ authTimeoutMs, maxSessionMs }));

const withdraw = (id: string) =>
  ({ _tag: "withdraw", id, p: "00".repeat(16), c: "00".repeat(8) }) as const;

const authenticated = (sessions: CardSessions) => {
  const socket = new FakeSocket();
  const card = newCard();
  sessions.open(socket);
  sessions.message(socket, authMessage(card, socket.challenge));
  return { card, socket };
};

/** Resolves with the request's answer, or "pending" if it is still open after `ms`. */
const settledWithin = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([promise, Bun.sleep(ms).then(() => "pending" as const)]);

describe("CardSessions", () => {
  test("a card that signs the challenge becomes reachable", async () => {
    const sessions = sessionsFor();
    const socket = new FakeSocket();
    const card = newCard();
    sessions.open(socket);
    sessions.message(socket, authMessage(card, socket.challenge));
    expect(socket.sent.at(-1)?._tag).toBe("ready");
    expect(sessions.activeCards).toBe(1);

    socket.onSend = (message) => {
      if (message._tag !== "withdraw") return;
      sessions.message(
        socket,
        encodeCardMessage({
          _tag: "rejected",
          id: message.id,
          reason: "No",
        }),
      );
    };
    const answer = await sessions.request(boltCardId(card), withdraw, 1_000);
    expect(answer).toEqual({ _tag: "rejected", id: "1", reason: "No" });
  });

  test("a wrong signature closes the socket", () => {
    const sessions = sessionsFor();
    const socket = new FakeSocket();
    sessions.open(socket);
    sessions.message(socket, authMessage(newCard(), "00".repeat(32)));
    expect(socket.closed?.code).toBe(CloseCode.invalidAuth);
    expect(sessions.activeCards).toBe(0);
  });

  test("an unauthenticated socket is closed after the timeout", async () => {
    const sessions = sessionsFor(5);
    const socket = new FakeSocket();
    sessions.open(socket);
    await Bun.sleep(20);
    expect(socket.closed?.code).toBe(CloseCode.authTimeout);
  });

  test("a newer session replaces the older one", () => {
    const sessions = sessionsFor();
    const card = newCard();
    const first = new FakeSocket();
    const second = new FakeSocket();
    sessions.open(first);
    sessions.message(first, authMessage(card, first.challenge));
    sessions.open(second);
    sessions.message(second, authMessage(card, second.challenge));
    expect(first.closed?.code).toBe(CloseCode.replaced);
    expect(sessions.activeCards).toBe(1);
  });

  test("requests without a session or an answer resolve to null", async () => {
    const sessions = sessionsFor();
    const card = newCard();
    expect(await sessions.request(boltCardId(card), withdraw, 1_000)).toBe(
      null,
    );

    const socket = new FakeSocket();
    sessions.open(socket);
    sessions.message(socket, authMessage(card, socket.challenge));
    expect(await sessions.request(boltCardId(card), withdraw, 5)).toBe(null);
  });

  test("closing a session answers its pending requests with null", async () => {
    const sessions = sessionsFor();
    const card = newCard();
    const socket = new FakeSocket();
    sessions.open(socket);
    sessions.message(socket, authMessage(card, socket.challenge));
    const answer = sessions.request(boltCardId(card), withdraw, 1_000);
    sessions.close(socket);
    expect(await answer).toBe(null);
    expect(sessions.activeCards).toBe(0);
  });

  test("ignores answers from another socket", async () => {
    const sessions = sessionsFor();
    const card = newCard();
    const socket = new FakeSocket();
    const other = new FakeSocket();
    sessions.open(socket);
    sessions.message(socket, authMessage(card, socket.challenge));
    sessions.open(other);
    sessions.message(other, authMessage(newCard(), other.challenge));
    const answer = sessions.request(boltCardId(card), withdraw, 20);
    sessions.message(other, encodeCardMessage({ _tag: "accepted", id: "1" }));
    expect(await answer).toBe(null);
  });

  test("a request to a socket that drops the message is answered at once", async () => {
    const sessions = sessionsFor();
    const { card, socket } = authenticated(sessions);
    // Closed on the wire, but Bun has not delivered the close event yet.
    socket.close();
    const answer = sessions.request(boltCardId(card), withdraw, 5_000);
    expect(await settledWithin(answer, 50)).toBe(null);
  });

  test("a request whose send throws is answered at once", async () => {
    const sessions = sessionsFor();
    const { card, socket } = authenticated(sessions);
    socket.throwOnSend = true;
    const answer = sessions.request(boltCardId(card), withdraw, 5_000);
    expect(await settledWithin(answer, 50)).toBe(null);
  });

  test("a late answer after the timeout is ignored", async () => {
    const sessions = sessionsFor();
    const { card, socket } = authenticated(sessions);
    expect(await sessions.request(boltCardId(card), withdraw, 5)).toBe(null);
    sessions.message(socket, encodeCardMessage({ _tag: "accepted", id: "1" }));
    expect(sessions.activeCards).toBe(1);
  });

  test("answers find their request by id, whatever the order", async () => {
    const sessions = sessionsFor();
    const { card, socket } = authenticated(sessions);
    const first = sessions.request(boltCardId(card), withdraw, 1_000);
    const second = sessions.request(boltCardId(card), withdraw, 1_000);
    await Bun.sleep(0);
    sessions.message(
      socket,
      encodeCardMessage({ _tag: "rejected", id: "2", reason: "second" }),
    );
    sessions.message(
      socket,
      encodeCardMessage({ _tag: "rejected", id: "1", reason: "first" }),
    );
    expect(await first).toMatchObject({ reason: "first" });
    expect(await second).toMatchObject({ reason: "second" });
  });

  test("a session is closed once it reaches its maximum age", async () => {
    const sessions = sessionsFor(1_000, 5);
    const { socket } = authenticated(sessions);
    await Bun.sleep(20);
    expect(socket.closed?.code).toBe(CloseCode.sessionExpired);
  });

  test("a malformed first message closes the socket", () => {
    const sessions = sessionsFor();
    const socket = new FakeSocket();
    sessions.open(socket);
    sessions.message(socket, "{}");
    expect(socket.closed?.code).toBe(CloseCode.invalidAuth);
  });

  test("an authenticated card cannot re-authenticate as another card", async () => {
    const sessions = sessionsFor();
    const { card, socket } = authenticated(sessions);
    const other = newCard();
    sessions.message(socket, authMessage(other, socket.challenge));
    expect(socket.sent.filter((m) => m._tag === "ready")).toHaveLength(1);
    expect(await sessions.request(boltCardId(other), withdraw, 1_000)).toBe(
      null,
    );
    socket.onSend = (message) => {
      if (message._tag === "withdraw") {
        sessions.message(
          socket,
          encodeCardMessage({ _tag: "accepted", id: message.id }),
        );
      }
    };
    expect(
      await sessions.request(boltCardId(card), withdraw, 1_000),
    ).toMatchObject({ _tag: "accepted" });
  });

  test("messages from a socket it never opened are ignored", () => {
    const sessions = sessionsFor();
    const stranger = new FakeSocket();
    sessions.message(stranger, authMessage(newCard(), "00".repeat(32)));
    expect(stranger.sent).toEqual([]);
    expect(stranger.closed).toBe(null);
  });

  describe("waiting for a card that has not connected yet", () => {
    const waitingSessions = (overrides = {}) =>
      new CardSessions(sessionOptions({ sessionWaitMs: 1_000, ...overrides }));

    /** Connects `card` and answers each withdraw with `accepted`. */
    const connectAnswering = (sessions: CardSessions, card = newCard()) => {
      const socket = new FakeSocket();
      socket.onSend = (message) => {
        if (message._tag === "withdraw") {
          sessions.message(
            socket,
            encodeCardMessage({ _tag: "accepted", id: message.id }),
          );
        }
      };
      sessions.open(socket);
      sessions.message(socket, authMessage(card, socket.challenge));
      return socket;
    };

    test("a request is answered once the card connects", async () => {
      const sessions = waitingSessions();
      const card = newCard();
      const answer = sessions.request(boltCardId(card), withdraw, 1_000);
      await Bun.sleep(30);
      connectAnswering(sessions, card);
      expect(await answer).toMatchObject({ _tag: "accepted" });
    });

    test("a request gives up when no card connects in time", async () => {
      const sessions = waitingSessions({ sessionWaitMs: 20 });
      const startedAt = Date.now();
      expect(
        await sessions.request(boltCardId(newCard()), withdraw, 1_000),
      ).toBe(null);
      expect(Date.now() - startedAt).toBeLessThan(500);
    });

    test("a card that reconnects picks up the requests waiting for it", async () => {
      const sessions = waitingSessions();
      const card = newCard();
      const first = connectAnswering(sessions, card);
      sessions.close(first);
      const answer = sessions.request(boltCardId(card), withdraw, 1_000);
      await Bun.sleep(10);
      connectAnswering(sessions, card);
      expect(await answer).toMatchObject({ _tag: "accepted" });
    });

    test("waiting requests are capped per card and in total", async () => {
      const perCard = waitingSessions({
        sessionWaitMs: 50,
        maxWaitersPerCard: 1,
      });
      const card = boltCardId(newCard());
      const waiting = perCard.request(card, withdraw, 1_000);
      expect(
        await settledWithin(perCard.request(card, withdraw, 1_000), 10),
      ).toBe(null);
      expect(await waiting).toBe(null);

      const total = waitingSessions({ sessionWaitMs: 50, maxWaiters: 1 });
      const other = total.request(boltCardId(newCard()), withdraw, 1_000);
      expect(
        await settledWithin(
          total.request(boltCardId(newCard()), withdraw, 1_000),
          10,
        ),
      ).toBe(null);
      expect(await other).toBe(null);
    });

    test("a slot freed by a timeout can be used again", async () => {
      const sessions = waitingSessions({ sessionWaitMs: 10, maxWaiters: 1 });
      expect(
        await sessions.request(boltCardId(newCard()), withdraw, 1_000),
      ).toBe(null);
      const card = newCard();
      const answer = sessions.request(boltCardId(card), withdraw, 1_000);
      connectAnswering(sessions, card);
      expect(await answer).toMatchObject({ _tag: "accepted" });
    });
  });
});
