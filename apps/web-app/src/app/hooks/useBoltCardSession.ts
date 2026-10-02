import {
  boltCardId,
  decodeBridgeMessage,
  encodeCardMessage,
  issueBoltCardTap,
  signBridgeChallenge,
  type BoltCard,
  type BoltCardId,
  type BridgeMessage,
} from "@linky-fit/bolt-card";
import React from "react";
import {
  listenNativeBoltCard,
  setNativeBoltCardUrl,
  startNativeBoltCard,
  stopNativeBoltCard,
  supportsNativeBoltCard,
  type NativeBoltCardEvent,
} from "../../platform/nativeBridge";
import { nowSeconds } from "../../utils/time";
import { reportBoltCardEvent } from "../lib/boltCardInspector";
import {
  boltCardBridgeSocketUrl,
  loadOrCreateBoltCard,
  saveBoltCard,
} from "../lib/boltCardStorage";
import {
  BoltCardTapSession,
  estimateMaxWithdrawableSat,
} from "../lib/boltCardTapSession";

/** How long the card may stay without a bridge session, at start or after a drop. */
export const BRIDGE_CONNECT_TIMEOUT_MS = 10_000;
/** Reconnect attempts after a drop, waiting this much longer before each. */
export const BRIDGE_RECONNECT_ATTEMPTS = 3;
export const BRIDGE_RECONNECT_DELAY_MS = 300;
// The bridge refuses this card for good: another session took it over or
// the signature failed. Reconnecting would only repeat that.
const FINAL_BRIDGE_CLOSE_CODES = new Set([4003, 4004]);

export type BoltCardSessionError =
  | "unsupported"
  | "nfcDisabled"
  | "bridge"
  | "storage"
  | "exhausted"
  | "native";

export type BoltCardSessionPhase =
  | { kind: "idle" }
  | { kind: "connecting" }
  | { kind: "ready" }
  | { kind: "paying"; amountSat: number }
  | { kind: "ended" }
  | { kind: "failed"; error: BoltCardSessionError };

interface UseBoltCardSessionParams {
  bridgeUrl: string;
  /** Largest balance at one mint; the offered maximum leaves the fee reserve. */
  spendableSat: number;
  /** Receives the POS invoice the card accepted; the caller pays it. */
  onInvoice: (invoice: string) => void;
}

type Timer = ReturnType<typeof setTimeout>;

interface SessionRuntime {
  readonly sessionId: string;
  readonly startedAtMs: number;
  readonly bridgeUrl: string;
  readonly cardId: BoltCardId;
  card: BoltCard;
  readonly taps: BoltCardTapSession;
  socket: WebSocket | null;
  /** Consecutive reconnects since the bridge last answered `ready`. */
  reconnects: number;
  armed: boolean;
  finished: boolean;
  /** Runs while there is no bridge session; fails the card when it fires. */
  bridgeTimer: Timer | null;
  reconnectTimer: Timer | null;
  unlisten: (() => void) | null;
}

const randomHex = (bytes: number): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

const report = (
  runtime: SessionRuntime,
  tag: Parameters<typeof reportBoltCardEvent>[0]["tag"],
  summary: string,
  payload: Parameters<typeof reportBoltCardEvent>[0]["payload"],
): void =>
  reportBoltCardEvent({
    tag,
    summary,
    sessionId: runtime.sessionId,
    cardId: runtime.cardId,
    bridgeUrl: runtime.bridgeUrl,
    payload,
  });

const clearTimer = (timer: Timer | null): null => {
  if (timer !== null) clearTimeout(timer);
  return null;
};

/**
 * One NFC bolt card session: arm NFC and connect the card to its bridge at
 * the same time, serve a fresh tap URL on every NFC read, answer the POS
 * through the bridge and hand the first accepted invoice to the wallet.
 * The bridge holds a POS request until the card connects, so arming does not
 * wait for the network. Runs until the caller stops it or unmounts (the
 * Send screen closes), the app pauses, that invoice arrives, or anything
 * fails, including a bridge that stays away for BRIDGE_CONNECT_TIMEOUT_MS.
 */
export const useBoltCardSession = ({
  bridgeUrl,
  spendableSat,
  onInvoice,
}: UseBoltCardSessionParams) => {
  const [phase, setPhase] = React.useState<BoltCardSessionPhase>({
    kind: "idle",
  });
  const runtimeRef = React.useRef<SessionRuntime | null>(null);
  // Bumped by every start and by unmount, so a start that awaited storage
  // never arms a card for a page that is gone or restarted.
  const generationRef = React.useRef(0);
  const spendableRef = React.useRef(spendableSat);
  const onInvoiceRef = React.useRef(onInvoice);
  React.useEffect(() => {
    spendableRef.current = spendableSat;
    onInvoiceRef.current = onInvoice;
  }, [onInvoice, spendableSat]);

  const finish = React.useCallback(
    (runtime: SessionRuntime, next: BoltCardSessionPhase) => {
      if (runtime.finished) return;
      runtime.finished = true;
      runtime.bridgeTimer = clearTimer(runtime.bridgeTimer);
      runtime.reconnectTimer = clearTimer(runtime.reconnectTimer);
      runtime.unlisten?.();
      stopNativeBoltCard();
      runtime.socket?.close(1000);
      report(
        runtime,
        "boltCard.sessionEnded",
        `bolt card session ${next.kind}`,
        {
          outcome: next.kind,
          reason: next.kind === "failed" ? next.error : null,
        },
      );
      if (runtimeRef.current === runtime) setPhase(next);
    },
    [],
  );

  /** Persists the advanced counter before the URL can be read. */
  const issueNextTap = React.useCallback(
    async (runtime: SessionRuntime): Promise<string | null> => {
      const tap = issueBoltCardTap(runtime.card, runtime.bridgeUrl);
      if (tap === null) {
        finish(runtime, { kind: "failed", error: "exhausted" });
        return null;
      }
      if (!(await saveBoltCard(tap.card))) {
        finish(runtime, { kind: "failed", error: "storage" });
        return null;
      }
      runtime.card = tap.card;
      runtime.taps.issue(tap);
      return runtime.finished ? null : tap.url;
    },
    [finish],
  );

  const handleNativeEvent = React.useCallback(
    async (runtime: SessionRuntime, event: NativeBoltCardEvent) => {
      switch (event.status) {
        case "started": {
          if (runtime.armed) return;
          runtime.armed = true;
          report(runtime, "boltCard.nfcStarted", "bolt card NFC armed", {
            msSinceStart: Date.now() - runtime.startedAtMs,
            routingConfirmed: event.message !== "unconfirmed",
          });
          setPhase({ kind: "ready" });
          return;
        }
        case "read": {
          report(runtime, "boltCard.tagRead", "a reader read the bolt card", {
            counter: runtime.card.counter,
          });
          const url = await issueNextTap(runtime);
          // Refused only when native stopped serving the card, e.g. the app
          // paused while the counter was being saved: the session is over.
          if (url !== null && !setNativeBoltCardUrl(url)) {
            finish(runtime, { kind: "ended" });
          }
          return;
        }
        case "deselected":
          return;
        case "stopped":
          finish(runtime, { kind: "ended" });
          return;
        case "disabled":
          finish(runtime, { kind: "failed", error: "nfcDisabled" });
          return;
        case "unsupported":
          finish(runtime, { kind: "failed", error: "unsupported" });
          return;
        case "error":
          finish(runtime, { kind: "failed", error: "native" });
          return;
      }
    },
    [finish, issueNextTap],
  );

  const handleBridgeMessage = React.useCallback(
    async (runtime: SessionRuntime, message: BridgeMessage) => {
      const send = (reply: Parameters<typeof encodeCardMessage>[0]) =>
        runtime.socket?.send(encodeCardMessage(reply));

      switch (message._tag) {
        case "challenge":
          send({
            _tag: "auth",
            cardId: runtime.cardId,
            signature: signBridgeChallenge(
              runtime.card.secretKey,
              message.challenge,
            ),
          });
          return;
        case "ready":
          runtime.bridgeTimer = clearTimer(runtime.bridgeTimer);
          report(runtime, "boltCard.bridgeReady", "bolt card bridge ready", {
            msSinceStart: Date.now() - runtime.startedAtMs,
            reconnects: runtime.reconnects,
          });
          runtime.reconnects = 0;
          return;
        case "withdraw": {
          const maxWithdrawableSat = estimateMaxWithdrawableSat(
            spendableRef.current,
          );
          const answer = runtime.taps.answerWithdraw(
            message,
            maxWithdrawableSat,
            randomHex(32),
          );
          send(answer.reply);
          report(
            runtime,
            "boltCard.withdrawAnswered",
            answer.reply._tag === "offer"
              ? `bolt card offered up to ${maxWithdrawableSat} sat`
              : "bolt card rejected a withdraw request",
            {
              outcome: answer.reply._tag,
              counter: answer.counter,
              maxWithdrawableSat,
              reason:
                answer.reply._tag === "rejected" ? answer.reply.reason : null,
            },
          );
          return;
        }
        case "callback": {
          const answer = runtime.taps.answerCallback(message, nowSeconds());
          send(answer.reply);
          report(
            runtime,
            "boltCard.invoiceAnswered",
            answer.invoice
              ? `bolt card accepted a ${answer.invoice.amountSat} sat invoice`
              : "bolt card rejected an invoice",
            {
              outcome: answer.reply._tag,
              amountSat: answer.invoice?.amountSat ?? null,
              reason:
                answer.reply._tag === "rejected" ? answer.reply.reason : null,
            },
          );
          if (answer.invoice === null) return;
          finish(runtime, {
            kind: "paying",
            amountSat: answer.invoice.amountSat,
          });
          onInvoiceRef.current(answer.invoice.invoice);
          return;
        }
      }
    },
    [finish],
  );

  const connectBridge = React.useCallback(
    (runtime: SessionRuntime) => {
      if (runtime.finished) return;
      runtime.reconnectTimer = null;
      // Every gap without a bridge session is bounded, the first one included.
      runtime.bridgeTimer ??= setTimeout(
        () => finish(runtime, { kind: "failed", error: "bridge" }),
        BRIDGE_CONNECT_TIMEOUT_MS,
      );

      const onClosed = (socket: WebSocket | null, code: number | null) => {
        if (runtime.finished || runtime.socket !== socket) return;
        runtime.socket = null;
        const final = code !== null && FINAL_BRIDGE_CLOSE_CODES.has(code);
        report(
          runtime,
          "boltCard.bridgeLost",
          "bolt card bridge connection lost",
          {
            code,
            reconnects: runtime.reconnects,
            willReconnect:
              !final && runtime.reconnects < BRIDGE_RECONNECT_ATTEMPTS,
          },
        );
        if (final || runtime.reconnects >= BRIDGE_RECONNECT_ATTEMPTS) {
          finish(runtime, { kind: "failed", error: "bridge" });
          return;
        }
        runtime.reconnects += 1;
        runtime.reconnectTimer = setTimeout(
          () => connectBridge(runtime),
          BRIDGE_RECONNECT_DELAY_MS * runtime.reconnects,
        );
      };

      let socket: WebSocket;
      try {
        socket = new WebSocket(boltCardBridgeSocketUrl(runtime.bridgeUrl));
      } catch {
        runtime.socket = null;
        onClosed(null, null);
        return;
      }
      runtime.socket = socket;
      socket.onmessage = (event) => {
        if (runtime.socket !== socket) return;
        const message = decodeBridgeMessage(String(event.data));
        if (message !== null) void handleBridgeMessage(runtime, message);
      };
      socket.onclose = (event) => onClosed(socket, event.code);
    },
    [finish, handleBridgeMessage],
  );

  const start = React.useCallback(async () => {
    const previous = runtimeRef.current;
    if (previous) finish(previous, { kind: "ended" });
    runtimeRef.current = null;
    generationRef.current += 1;
    const generation = generationRef.current;

    if (!supportsNativeBoltCard()) {
      setPhase({ kind: "failed", error: "unsupported" });
      return;
    }
    setPhase({ kind: "connecting" });
    const startedAtMs = Date.now();
    const card = await loadOrCreateBoltCard();
    if (generation !== generationRef.current) return;
    if (card === null) {
      setPhase({ kind: "failed", error: "storage" });
      return;
    }

    const runtime: SessionRuntime = {
      sessionId: randomHex(8),
      startedAtMs,
      bridgeUrl,
      cardId: boltCardId(card),
      card,
      taps: new BoltCardTapSession(card),
      socket: null,
      reconnects: 0,
      armed: false,
      finished: false,
      bridgeTimer: null,
      reconnectTimer: null,
      unlisten: null,
    };
    runtimeRef.current = runtime;
    report(runtime, "boltCard.sessionStarted", "bolt card session started", {
      counter: card.counter,
      cardLoadMs: Date.now() - startedAtMs,
    });

    runtime.unlisten = listenNativeBoltCard(
      (event) => void handleNativeEvent(runtime, event),
    );
    // The network round trips start first; arming NFC needs only local work.
    connectBridge(runtime);
    const url = await issueNextTap(runtime);
    if (url !== null && !startNativeBoltCard(url)) {
      finish(runtime, { kind: "failed", error: "native" });
    }
  }, [bridgeUrl, connectBridge, finish, handleNativeEvent, issueNextTap]);

  const stop = React.useCallback(() => {
    const runtime = runtimeRef.current;
    if (runtime) finish(runtime, { kind: "ended" });
  }, [finish]);

  React.useEffect(
    () => () => {
      generationRef.current += 1;
      const runtime = runtimeRef.current;
      runtimeRef.current = null;
      if (runtime) finish(runtime, { kind: "ended" });
    },
    [finish],
  );

  return { phase, start, stop };
};
