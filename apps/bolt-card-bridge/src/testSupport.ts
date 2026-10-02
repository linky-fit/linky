import {
  boltCardId,
  createBoltCard,
  decodeBridgeMessage,
  encodeCardMessage,
  signBridgeChallenge,
  type BoltCard,
  type BridgeMessage,
} from "@linky-fit/bolt-card";
import type { CardSessions, CardSocket } from "./sessions";

export class FakeSocket implements CardSocket {
  readonly sent: BridgeMessage[] = [];
  closed: { code: number | undefined; reason: string | undefined } | null =
    null;
  onSend: ((message: BridgeMessage) => void) | null = null;
  /** Simulates a send that throws instead of reporting a drop. */
  throwOnSend = false;

  /** Like Bun: a closed socket drops the message and reports 0. */
  send(text: string): number {
    if (this.throwOnSend) throw new Error("socket is gone");
    if (this.closed) return 0;
    const message = decodeBridgeMessage(text);
    if (message === null) throw new Error(`bridge sent malformed ${text}`);
    this.sent.push(message);
    this.onSend?.(message);
    return text.length;
  }

  close(code?: number, reason?: string): void {
    this.closed = { code, reason };
  }

  get challenge(): string {
    const first = this.sent[0];
    if (first?._tag !== "challenge") throw new Error("no challenge sent");
    return first.challenge;
  }
}

export const authMessage = (card: BoltCard, challenge: string): string =>
  encodeCardMessage({
    _tag: "auth",
    cardId: boltCardId(card),
    signature: signBridgeChallenge(card.secretKey, challenge),
  });

export const newCard = (): BoltCard => createBoltCard();

/** Session options for tests: short waits so a missing card fails fast. */
export const sessionOptions = (
  overrides: Partial<ConstructorParameters<typeof CardSessions>[0]> = {},
): ConstructorParameters<typeof CardSessions>[0] => ({
  authTimeoutMs: 1_000,
  maxSessionMs: 10_000,
  sessionWaitMs: 20,
  maxWaitersPerCard: 4,
  maxWaiters: 100,
  ...overrides,
});
