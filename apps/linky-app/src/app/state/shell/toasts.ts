import { Atom, type AtomRegistry } from "effect/reactivity";

const MAX_VISIBLE_TOASTS = 2;
const TOAST_DURATION_MS = 2500;
const ACTION_TOAST_DURATION_MS = 6000;

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: string;
  message: string;
  onClick?: () => void;
  actions?: ReadonlyArray<ToastAction>;
}

export interface PushToastOptions {
  onClick?: () => void;
  actions?: ReadonlyArray<ToastAction>;
}

export type PushToast = (message: string, options?: PushToastOptions) => void;

export interface ToastCommands {
  readonly pushToast: PushToast;
  readonly dismissToast: (id: string) => void;
}

/** The toasts on screen, newest last. */
export const toastsAtom = Atom.keepAlive(Atom.make<ReadonlyArray<Toast>>([]));

const makeToastCommands = (
  registry: AtomRegistry.AtomRegistry,
): ToastCommands & { readonly clearTimers: () => void } => {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const clearTimer = (id: string) => {
    const timer = timers.get(id);
    if (timer === undefined) return;
    clearTimeout(timer);
    timers.delete(id);
  };
  const remove = (id: string) =>
    registry.update(toastsAtom, (toasts) =>
      toasts.filter((toast) => toast.id !== id),
    );

  return {
    dismissToast: (id) => {
      remove(id);
      clearTimer(id);
    },
    pushToast: (message, options) => {
      const text = message.trim();
      if (!text) return;

      const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const next = [
        ...registry.get(toastsAtom),
        {
          id,
          message: text,
          ...(options?.onClick ? { onClick: options.onClick } : {}),
          ...(options?.actions ? { actions: options.actions } : {}),
        },
      ];
      for (const dropped of next.slice(0, -MAX_VISIBLE_TOASTS)) {
        clearTimer(dropped.id);
      }
      registry.set(toastsAtom, next.slice(-MAX_VISIBLE_TOASTS));

      timers.set(
        id,
        setTimeout(
          () => {
            remove(id);
            timers.delete(id);
          },
          options?.actions ? ACTION_TOAST_DURATION_MS : TOAST_DURATION_MS,
        ),
      );
    },
    clearTimers: () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
};

export const toastCommandsAtom = Atom.keepAlive(
  Atom.readable((get): ToastCommands => {
    const commands = makeToastCommands(get.registry);
    get.addFinalizer(commands.clearTimers);
    return commands;
  }),
);
