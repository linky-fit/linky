import type { RestoreProgress } from "@linky-fit/linkshu";
import type { PaymentRequestId } from "@linky-fit/linkshu/payment-request";
import { Atom } from "effect/reactivity";
import type { CashuOperationId } from "../../../evolu";

/** True while "check all tokens" runs; the token screens stay busy meanwhile. */
export const tokenBulkCheckBusyAtom = Atom.keepAlive(Atom.make(false));

export interface TokenRecovery {
  /** Only a scan for missing tokens marks the screens busy; a reclaim does not. */
  readonly busy: boolean;
  readonly progress: RestoreProgress | null;
}

export const tokenRecoveryAtom = Atom.keepAlive(
  Atom.make<TokenRecovery>({ busy: false, progress: null }),
);

/** The issued token the user is choosing a contact to send to. */
export const tokenContactPickAtom = Atom.keepAlive(
  Atom.make<CashuOperationId | null>(null),
);

/** The amount typed on the issue-token screen, kept across navigation until a token is issued. */
export const issueTokenAmountAtom = Atom.keepAlive(Atom.make(""));

/** The token text typed on the receive-token screen; a failed receive puts it back. */
export const receiveTokenDraftAtom = Atom.keepAlive(Atom.make(""));

/** The request ids of the payment payloads this device received this session. */
export const receivedPaymentRequestIdsAtom = Atom.keepAlive(
  Atom.make<ReadonlySet<PaymentRequestId>>(new Set<PaymentRequestId>()),
);

/** Marks one kind of token work as running, so a second tap meanwhile is dropped rather than queued. */
export interface RunGuard {
  readonly isRunning: () => boolean;
  readonly enter: () => void;
  readonly leave: () => void;
}

const makeRunGuard = (): RunGuard => {
  let running = false;
  return {
    isRunning: () => running,
    enter: () => {
      running = true;
    },
    leave: () => {
      running = false;
    },
  };
};

export const tokenRunGuardsAtom = Atom.keepAlive(
  Atom.readable(() => ({ reclaim: makeRunGuard(), recover: makeRunGuard() })),
);
