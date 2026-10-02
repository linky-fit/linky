import { randomBytes } from "node:crypto";
import {
  decodeCardMessage,
  encodeBridgeMessage,
  verifyBridgeChallenge,
  type BoltCardId,
  type BridgeMessage,
  type CardMessage,
} from "@linky-fit/bolt-card";
import {
  bridgeMessageFields,
  cardMessageFields,
  shortCardId,
  silentLog,
  type DebugLog,
} from "./debugLog";

/** The part of a Bun ServerWebSocket the sessions use, so tests can fake it. */
export interface CardSocket {
  /** Bun's send status: 0 when the message was dropped, e.g. on a closing socket. */
  send(text: string): number;
  close(code?: number, reason?: string): void;
}

/** Close codes the app shows as a reason to stop the session. */
export const CloseCode = {
  authTimeout: 4001,
  invalidAuth: 4003,
  replaced: 4004,
  sessionExpired: 4005,
} as const;

interface SocketState {
  /** Numbers sockets in debug lines, so one card's reconnects stay apart. */
  readonly number: number;
  readonly challenge: string;
  cardId: BoltCardId | null;
  timer: ReturnType<typeof setTimeout>;
}

interface PendingRequest {
  readonly socket: CardSocket;
  readonly sentAtMs: number;
  readonly resolve: (message: CardMessage | null) => void;
}

interface CardSessionsOptions {
  authTimeoutMs: number;
  maxSessionMs: number;
  /** How long a POS request waits for a card that has not connected yet. */
  sessionWaitMs: number;
  maxWaitersPerCard: number;
  maxWaiters: number;
  log?: DebugLog;
}

type SessionWaiter = (socket: CardSocket | null) => void;

/**
 * Live card sockets keyed by the card id they proved. A card has at most one
 * session; a newer authenticated socket replaces the older one.
 */
export class CardSessions {
  private readonly sockets = new Map<CardSocket, SocketState>();
  private readonly byCard = new Map<BoltCardId, CardSocket>();
  private readonly pending = new Map<string, PendingRequest>();
  private readonly waiters = new Map<BoltCardId, Set<SessionWaiter>>();
  private waiterCount = 0;
  private nextRequestId = 0;
  private nextSocketNumber = 0;
  private readonly options: CardSessionsOptions;
  private readonly log: DebugLog;

  constructor(options: CardSessionsOptions) {
    this.options = options;
    this.log = options.log ?? silentLog;
  }

  private cardFields(state: SocketState) {
    return {
      socket: state.number,
      card: state.cardId === null ? undefined : shortCardId(state.cardId),
    };
  }

  get activeCards(): number {
    return this.byCard.size;
  }

  open(socket: CardSocket): void {
    const challenge = randomBytes(32).toString("hex");
    this.nextSocketNumber += 1;
    const number = this.nextSocketNumber;
    this.sockets.set(socket, {
      number,
      challenge,
      cardId: null,
      timer: setTimeout(() => {
        this.log("socket.authTimeout", { socket: number });
        socket.close(CloseCode.authTimeout, "authentication timeout");
      }, this.options.authTimeoutMs),
    });
    this.log("socket.open", { socket: number });
    socket.send(encodeBridgeMessage({ _tag: "challenge", challenge }));
  }

  message(socket: CardSocket, text: string): void {
    const state = this.sockets.get(socket);
    if (!state) return;
    const message = decodeCardMessage(text);

    if (state.cardId === null) {
      if (
        message?._tag !== "auth" ||
        !verifyBridgeChallenge(
          message.cardId,
          state.challenge,
          message.signature,
        )
      ) {
        this.log("socket.authRejected", {
          socket: state.number,
          reason:
            message?._tag === "auth" ? "signature" : "not an auth message",
        });
        socket.close(CloseCode.invalidAuth, "invalid authentication");
        return;
      }
      const previous = this.byCard.get(message.cardId);
      if (previous && previous !== socket) {
        this.log("socket.replaced", {
          card: shortCardId(message.cardId),
          previousSocket: this.sockets.get(previous)?.number,
          socket: state.number,
        });
        this.close(previous, CloseCode.replaced);
        previous.close(CloseCode.replaced, "replaced by a newer session");
      }
      clearTimeout(state.timer);
      state.cardId = message.cardId;
      state.timer = setTimeout(() => {
        this.log("socket.expired", this.cardFields(state));
        socket.close(CloseCode.sessionExpired, "session expired");
      }, this.options.maxSessionMs);
      this.byCard.set(message.cardId, socket);
      this.log("socket.authenticated", this.cardFields(state));
      socket.send(encodeBridgeMessage({ _tag: "ready" }));
      for (const waiter of [...(this.waiters.get(message.cardId) ?? [])]) {
        waiter(socket);
      }
      return;
    }

    if (message === null || message._tag === "auth") {
      this.log("card.ignored", {
        ...this.cardFields(state),
        reason: message === null ? "malformed" : "repeated auth",
      });
      return;
    }
    const request = this.pending.get(message.id);
    if (request?.socket !== socket) {
      this.log("card.unmatched", {
        ...this.cardFields(state),
        request: message.id,
        ...cardMessageFields(message),
      });
      return;
    }
    this.log("card.reply", {
      ...this.cardFields(state),
      request: message.id,
      ms: Date.now() - request.sentAtMs,
      ...cardMessageFields(message),
    });
    request.resolve(message);
  }

  /** `code` is the WebSocket close code, only for the debug line. */
  close(socket: CardSocket, code?: number): void {
    const state = this.sockets.get(socket);
    if (!state) return;
    clearTimeout(state.timer);
    this.sockets.delete(socket);
    if (state.cardId !== null && this.byCard.get(state.cardId) === socket) {
      this.byCard.delete(state.cardId);
    }
    let aborted = 0;
    for (const [id, request] of this.pending) {
      if (request.socket !== socket) continue;
      this.pending.delete(id);
      request.resolve(null);
      aborted += 1;
    }
    this.log("socket.closed", {
      ...this.cardFields(state),
      code,
      abortedRequests: aborted,
    });
  }

  /**
   * The card's session, or the one it opens within `sessionWaitMs`: the app
   * arms NFC while it is still connecting, so a fast POS can arrive first.
   */
  private waitForSession(cardId: BoltCardId): Promise<CardSocket | null> {
    const existing = this.byCard.get(cardId);
    if (existing) return Promise.resolve(existing);
    const forCard = this.waiters.get(cardId) ?? new Set<SessionWaiter>();
    const fields = { card: shortCardId(cardId) };
    // Waiting requests hold a connection open, so made-up card ids must not
    // pile them up.
    if (
      forCard.size >= this.options.maxWaitersPerCard ||
      this.waiterCount >= this.options.maxWaiters
    ) {
      this.log("card.waitRejected", { ...fields, waiting: forCard.size });
      return Promise.resolve(null);
    }
    const startedAtMs = Date.now();
    return new Promise((resolve) => {
      const waiter: SessionWaiter = (socket) => {
        clearTimeout(timer);
        forCard.delete(waiter);
        if (forCard.size === 0) this.waiters.delete(cardId);
        this.waiterCount -= 1;
        if (socket) {
          this.log("card.waitResolved", {
            ...fields,
            ms: Date.now() - startedAtMs,
          });
        }
        resolve(socket);
      };
      const timer = setTimeout(() => {
        this.log("card.waitTimeout", {
          ...fields,
          ms: this.options.sessionWaitMs,
        });
        waiter(null);
      }, this.options.sessionWaitMs);
      forCard.add(waiter);
      this.waiters.set(cardId, forCard);
      this.waiterCount += 1;
      this.log("card.waiting", fields);
    });
  }

  /**
   * Forwards a request to the card's session, waiting briefly for one to
   * open; null without a session or answer.
   */
  async request(
    cardId: BoltCardId,
    build: (id: string) => BridgeMessage,
    timeoutMs: number,
  ): Promise<CardMessage | null> {
    const socket = await this.waitForSession(cardId);
    if (!socket) return null;
    this.nextRequestId += 1;
    const id = String(this.nextRequestId);
    const message = build(id);
    const fields = { card: shortCardId(cardId), request: id };
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.log("card.timeout", { ...fields, ms: timeoutMs });
        settle(null);
      }, timeoutMs);
      const settle = (answer: CardMessage | null) => {
        clearTimeout(timer);
        this.pending.delete(id);
        resolve(answer);
      };
      this.pending.set(id, { socket, sentAtMs: Date.now(), resolve: settle });
      this.log("card.send", { ...fields, ...bridgeMessageFields(message) });
      // A socket that is closing drops the message; nothing can answer it,
      // so the POS hears "not active" now instead of after the timeout.
      let status: number;
      try {
        status = socket.send(encodeBridgeMessage(message));
      } catch {
        status = 0;
      }
      if (status === 0) {
        this.log("card.dropped", fields);
        settle(null);
      }
    });
  }
}
