import { Context, Effect, Option, Semaphore } from "effect";
import { Atom } from "effect/reactivity";
import { platformAtom } from "../platform";

export interface WalletOps {
  /**
   * Runs `operation` unless any wallet operation is running; one started
   * meanwhile is dropped (`None`), never queued. User-started payments,
   * moves and checks run this way.
   */
  readonly runExclusive: <A, E, R>(
    operation: Effect.Effect<A, E, R>,
  ) => Effect.Effect<Option.Option<A>, E, R>;
  /**
   * Runs `operation` after the queued ones before it; it is never dropped
   * and makes exclusive operations started meanwhile drop. Receives,
   * reclaims and restores run this way; a `background` one (a retry pass)
   * only waits its turn. Each holds back an app update until it settles.
   */
  readonly runQueued: <A, E, R>(
    operation: Effect.Effect<A, E, R>,
    options?: QueuedOptions,
  ) => Effect.Effect<A, E, R>;
  /** `runExclusive` over a promise; a rejection rejects. */
  readonly runExclusiveTask: RunExclusiveTask;
  /** `runQueued` over a promise; a rejection rejects. */
  readonly runQueuedTask: RunQueuedTask;
}

export interface QueuedOptions {
  readonly background?: boolean;
}

export type RunExclusiveTask = <A>(
  task: () => Promise<A>,
) => Promise<Option.Option<A>>;

export type RunQueuedTask = <A>(
  task: () => Promise<A>,
  options?: QueuedOptions,
) => Promise<A>;

export const makeWalletOps = (
  onRunningChange: (running: boolean) => void,
  deferUpdateWhile: (work: Promise<void>) => void = () => {},
): WalletOps => {
  let running = 0;
  const queue = Semaphore.makeUnsafe(1);
  const enter = Effect.sync(() => {
    running += 1;
    if (running === 1) onRunningChange(true);
  });
  const leave = Effect.sync(() => {
    running -= 1;
    if (running === 0) onRunningChange(false);
  });
  const tryEnter = Effect.suspend(() =>
    running > 0 ? Effect.succeed(false) : Effect.as(enter, true),
  );

  const runExclusive: WalletOps["runExclusive"] = (operation) =>
    Effect.acquireUseRelease(
      tryEnter,
      (entered) => (entered ? Effect.asSome(operation) : Effect.succeedNone),
      (entered) => (entered ? leave : Effect.void),
    );
  const holdUpdate = Effect.sync(() => {
    let settle = () => {};
    deferUpdateWhile(
      new Promise<void>((resolve) => {
        settle = resolve;
      }),
    );
    return settle;
  });

  const runQueued: WalletOps["runQueued"] = (operation, options) =>
    Effect.acquireUseRelease(
      holdUpdate,
      () =>
        queue.withPermits(1)(
          options?.background === true
            ? operation
            : Effect.acquireUseRelease(
                enter,
                () => operation,
                () => leave,
              ),
        ),
      (settle) => Effect.sync(settle),
    );

  return {
    runExclusive,
    runQueued,
    runExclusiveTask: (task) =>
      Effect.runPromise(runExclusive(Effect.promise(task))),
    runQueuedTask: (task, options) =>
      Effect.runPromise(runQueued(Effect.promise(task), options)),
  };
};

/** True while any wallet operation runs; the top bar shows it as busy. */
export const walletOpRunningAtom = Atom.keepAlive(Atom.make(false));

/** The one wallet operation queue of the page, shared by every linkshu runtime build. */
export const walletOpsAtom = Atom.keepAlive(
  Atom.readable((get) =>
    makeWalletOps(
      (running) => get.registry.set(walletOpRunningAtom, running),
      get(platformAtom).lifecycle.deferUpdateWhile,
    ),
  ),
);

/** The page's wallet operation queue inside the linkshu runtime; see `WalletOps`. */
export class WalletOpQueue extends Context.Service<WalletOpQueue, WalletOps>()(
  "linky/WalletOpQueue",
) {}
