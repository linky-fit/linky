import type { MintQuoteBolt11Response } from "@cashu/cashu-ts";
import { NetworkError } from "@cashu/cashu-ts";
import { Duration, Effect, Schedule } from "effect";
import type { MintRejected, MintUnreachable } from "../domain/errors";
import type { CurrencyUnit, MintUrl, QuoteId } from "../domain/primitives";
import { classifyMintError } from "../mint/internal/WalletInstances";
import type { LoadedWallet } from "../mint/internal/WalletInstances";
import { QUOTE_UNPAID } from "./quoteClaim";
import { Inspector } from "../inspector/Inspector";
import { inspectFailureWith } from "./operations";

type MintSocket = NonNullable<LoadedWallet["mint"]["webSocketConnection"]>;
type CloseListener = (error: NetworkError) => void;

// cashu-ts has no offClose; keep one dispatcher per connection and remove
// each subscriber from its set on settlement, failure, or interruption.
const closeListeners = new WeakMap<MintSocket, Set<CloseListener>>();

const registerCloseDispatcher = (socket: MintSocket): Set<CloseListener> => {
  const listeners = new Set<CloseListener>();
  closeListeners.set(socket, listeners);
  socket.onClose((event) => {
    const error = new NetworkError(`WebSocket closed (code ${event.code})`);
    for (const listener of [...listeners]) listener(error);
  });
  return listeners;
};

const onSocketClose = (
  socket: MintSocket,
  fail: CloseListener,
): (() => void) => {
  const listeners =
    closeListeners.get(socket) ?? registerCloseDispatcher(socket);
  listeners.add(fail);
  return () => {
    listeners.delete(fail);
  };
};

/**
 * cashu-ts opens one websocket per mint and shares it across subscriptions,
 * so the socket may only be torn down once the last subscriber is gone —
 * several pending topups on one mint run at the same time. Leaving it open
 * instead is not an option: it keeps a plain-Node process from ever exiting.
 */
const openSubscriptions = new WeakMap<LoadedWallet, number>();

const retainSocket = (wallet: LoadedWallet): void => {
  openSubscriptions.set(wallet, (openSubscriptions.get(wallet) ?? 0) + 1);
};

const releaseSocket = (wallet: LoadedWallet): void => {
  const open = (openSubscriptions.get(wallet) ?? 1) - 1;
  openSubscriptions.set(wallet, Math.max(0, open));
  if (open > 0) return;
  try {
    wallet.mint.disconnectWebSocket();
  } catch {
    // A socket that cannot be closed is already gone.
  }
};

const BOLT11_METHOD = "bolt11";
const MINT_QUOTE_COMMAND = "bolt11_mint_quote";

/**
 * A socket the OS tears down while the app is backgrounded takes the pending
 * subscription with it and the mint pushes each state only once, so the
 * settlement is missed unless we subscribe again. Backoff caps out because
 * the poll is carrying the topup meanwhile; this only restores the shortcut.
 */
const RESUBSCRIBE_SCHEDULE = Schedule.exponential(Duration.seconds(1)).pipe(
  Schedule.either(Schedule.spaced(Duration.seconds(30))),
);

/**
 * Websocket support is per method and unit, so a mint may push bolt11/sat
 * quotes and nothing else. An unloaded mint info throws rather than answering,
 * and an unknown answer means the same as "no": keep polling.
 */
export const supportsMintQuoteSubscription = (
  wallet: LoadedWallet,
  unit: CurrencyUnit,
): boolean => {
  try {
    const support = wallet.getMintInfo().isSupported(17);
    if (!support.supported) return false;
    return (support.params ?? []).some(
      (entry) =>
        entry.method === BOLT11_METHOD &&
        entry.unit === unit &&
        entry.commands.includes(MINT_QUOTE_COMMAND),
    );
  } catch {
    return false;
  }
};

/**
 * One subscription's lifetime: resolves with the first state that is not
 * UNPAID, and fails when the socket does. `mintQuoteUpdates` rather than
 * `mintQuotePaid`, because the latter reports nothing for a quote that is
 * already ISSUED — the state a resume after a lost mint response must see.
 */
const subscribeOnce = (
  wallet: LoadedWallet,
  quote: { readonly quoteId: QuoteId; readonly mint: MintUrl },
): Effect.Effect<MintQuoteBolt11Response, MintUnreachable | MintRejected> =>
  Effect.async<MintQuoteBolt11Response, MintUnreachable | MintRejected>(
    (resume) => {
      let cancel: (() => void) | null = null;
      let removeCloseListener: (() => void) | null = null;
      let settled = false;

      const stop = (): void => {
        if (settled) return;
        settled = true;
        removeCloseListener?.();
        removeCloseListener = null;
        cancel?.();
        cancel = null;
      };

      const fail = (error: unknown): void => {
        if (settled) return;
        stop();
        resume(Effect.fail(classifyMintError(quote.mint, error)));
      };

      wallet.on
        .mintQuoteUpdates(
          [quote.quoteId],
          (update) => {
            // The state replayed on subscribe is usually still UNPAID; keep
            // the subscription open until the mint reports the settlement.
            if (settled || update.state === QUOTE_UNPAID) return;
            stop();
            resume(Effect.succeed(update));
          },
          fail,
        )
        .then((canceller) => {
          // The subscription may land after the effect was interrupted or the
          // quote already reported settled; either way it must not stay open.
          if (settled) {
            canceller();
            return;
          }
          cancel = canceller;
          const socket = wallet.mint.webSocketConnection;
          if (socket === undefined) {
            fail(new NetworkError("Mint websocket unavailable"));
            return;
          }
          removeCloseListener = onSocketClose(socket, fail);
        })
        .catch(fail);

      return Effect.sync(stop);
    },
  );

/**
 * Resolves with the quote the mint reports as settled, re-subscribing for as
 * long as it takes. The socket stays retained across the backoff between
 * attempts, so a sibling settling meanwhile does not close the connection
 * this subscriber is about to reuse. Interrupting cancels whatever
 * subscription is open.
 */
export const awaitMintQuoteSettled = (
  wallet: LoadedWallet,
  quote: { readonly quoteId: QuoteId; readonly mint: MintUrl },
): Effect.Effect<MintQuoteBolt11Response, MintUnreachable | MintRejected> =>
  Effect.gen(function* () {
    const inspector = yield* Inspector.orNoop;
    return yield* Effect.acquireUseRelease(
      Effect.sync(() => retainSocket(wallet)),
      () =>
        subscribeOnce(wallet, quote).pipe(
          inspectFailureWith(inspector, "topup.subscribe", {
            mint: quote.mint,
            quoteId: quote.quoteId,
          }),
          Effect.retry(RESUBSCRIBE_SCHEDULE),
        ),
      () => Effect.sync(() => releaseSocket(wallet)),
    );
  });
