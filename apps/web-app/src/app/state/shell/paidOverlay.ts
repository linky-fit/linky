import { Atom, type AtomRegistry } from "effect/reactivity";
import type {
  PaidOverlayDetails,
  PaidOverlayPhase,
} from "../../lib/paidOverlay";

export interface PaidOverlay {
  readonly details: PaidOverlayDetails | null;
  readonly phase: PaidOverlayPhase;
  readonly title: string | null;
}

export interface PaidOverlayCommands {
  /** Opens the overlay in the `sending` phase as soon as a payment starts. */
  readonly showPaymentSending: (details: PaidOverlayDetails) => void;
  /** Closes a `sending` overlay when the payment ends without a confirmation. */
  readonly dismissPaymentSending: () => void;
  /** Turns the overlay into the `done` confirmation, which closes itself. */
  readonly showPaid: (
    title: string,
    details: PaidOverlayDetails | null,
  ) => void;
}

const PAID_OVERLAY_DURATION_MS = 2000;

/** The paid overlay on screen, or null. */
export const paidOverlayAtom = Atom.keepAlive(
  Atom.make<PaidOverlay | null>(null),
);

const makePaidOverlayCommands = (
  registry: AtomRegistry.AtomRegistry,
): PaidOverlayCommands & { readonly clearTimer: () => void } => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  return {
    clearTimer,
    showPaymentSending: (details) => {
      clearTimer();
      registry.set(paidOverlayAtom, { details, phase: "sending", title: null });
    },
    dismissPaymentSending: () =>
      registry.update(paidOverlayAtom, (current) =>
        current?.phase === "sending" ? null : current,
      ),
    showPaid: (title, details) => {
      clearTimer();
      registry.set(paidOverlayAtom, { details, phase: "done", title });
      timer = setTimeout(() => {
        registry.set(paidOverlayAtom, null);
        timer = null;
      }, PAID_OVERLAY_DURATION_MS);
    },
  };
};

export const paidOverlayCommandsAtom = Atom.keepAlive(
  Atom.readable((get): PaidOverlayCommands => {
    const commands = makePaidOverlayCommands(get.registry);
    get.addFinalizer(commands.clearTimer);
    return commands;
  }),
);
