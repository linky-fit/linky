# React

`@linky/linkstr-react` is the effect-atom binding: one config atom, one runtime atom built from it, and a fn atom per operation. Use it for every linkstr call made from a component or hook in the web app; never build layers by hand there.

## Configure

`linkstrConfigAtom` holds a `LinkstrConfig | null`. Set it when an identity is available; set it to `null` on logout. While it is null, every fn atom fails with `LinkstrNotConfigured`. The minimum is a key and relays:

```tsx
import { identityFromNsec, RelayUrl } from "@linky/linkstr";
import {
  linkstrConfigAtom,
  useAtomSet,
  type LinkstrConfig,
} from "@linky/linkstr-react";
import { Schema } from "effect";
import React from "react";

const isRelayUrl = Schema.is(RelayUrl);

const buildConfig = (
  nsec: string | null,
  relayUrls: readonly string[],
): LinkstrConfig | null => {
  const identity = nsec === null ? null : identityFromNsec(nsec.trim());
  if (identity === null) return null;
  const relays = relayUrls.filter(isRelayUrl);
  return {
    secretKey: identity.secretKey,
    readRelays: relays,
    writeRelays: relays,
  };
};

/** Mount once near the root; `nsec` is null while logged out. */
export const useLinkstrConfigSync = (
  nsec: string | null,
  relayUrls: readonly string[],
) => {
  const setConfig = useAtomSet(linkstrConfigAtom);
  React.useEffect(() => {
    setConfig(buildConfig(nsec, relayUrls));
  }, [nsec, relayUrls, setConfig]);
};
```

## Call an operation

Every operation is a `linkstrRuntimeAtom.fn` atom. `useAtomSet(atom, { mode: "promiseExit" })` returns a function that resolves with an `Exit`; call it from a handler. The web app sends reactions through the outbox, so that is the first button:

```tsx
import {
  Emoji,
  OutboxRef,
  ReactionDraft,
  type Pubkey,
  type RumorId,
} from "@linky/linkstr";
import { enqueueOutboxAtom, useAtomSet } from "@linky/linkstr-react";
import { Cause, Exit } from "effect";

interface ReactButtonProps {
  peer: Pubkey;
  messageId: RumorId;
}

export const ReactButton = ({ peer, messageId }: ReactButtonProps) => {
  const enqueue = useAtomSet(enqueueOutboxAtom, { mode: "promiseExit" });

  const onClick = async () => {
    const draft = new ReactionDraft({
      to: peer,
      target: messageId,
      targetKind: "text",
      targetAuthor: peer,
      emoji: Emoji.make("🔥"),
    });
    const exit = await enqueue({
      op: { _tag: "reaction", draft },
      ref: OutboxRef.make(`reaction:${messageId}`),
    });
    if (Exit.isFailure(exit)) {
      console.warn(Cause.pretty(exit.cause)); // LinkstrNotConfigured while logged out
      return;
    }
    console.log("queued rumor", exit.value.rumorId);
  };

  return <button onClick={() => void onClick()}>🔥</button>;
};
```

`enqueue` resolves as soon as the job is stored; delivery happens in the background and reports through the outbox results ([Outbox](#outbox) below). With the minimal config the queue lives in memory and is lost on reload; the next section adds storage.

`mode: "promise"` resolves with the value and rejects on failure; the default mode returns `void` and you read the atom's `Result` with `useAtomValue`. Prefer `promiseExit` in event handlers: failures are typed values, not thrown.

| Atom                                               | Input                                         | Success value                            |
| -------------------------------------------------- | --------------------------------------------- | ---------------------------------------- |
| `enqueueOutboxAtom`                                | `{ op: RumorFixedOperation, ref: OutboxRef }` | `EnqueueReceipt`                         |
| `enqueuePaymentTelemetryAtom`                      | `{ draft, recipient, ref }`                   | `OutboxJobId`                            |
| `retractReactionAtom`                              | `RetractionDraft`                             | `RetractionReceipt`                      |
| `sendSeenReceiptAtom`                              | `SeenReceiptDraft`                            | `SeenReceiptSendReceipt`                 |
| `sendPaymentNoticeAtom`                            | `PaymentNoticeDraft`                          | `PaymentNoticeReceipt`                   |
| `sendBankOfferAtom`                                | `BankOfferDraft`                              | `BankOfferReceipt`                       |
| `publishProfileAtom`, `publishStatusAtom`          | `ProfileMetadata`, `StatusDraft`              | `PlainEventReceipt`                      |
| `fetchProfileAtom`, `fetchProfilesAtom`            | `Pubkey`, `ReadonlyArray<Pubkey>`             | `ProfileFetchResult`, entries            |
| `discoverActiveProfilesAtom`, `searchProfilesAtom` | options, `{ query, options? }`                | discovered profiles                      |
| `publishRelayListsAtom`, `fetchOwnRelayListsAtom`  | `RelayListsDraft`, `void`                     | `RelayListsReceipt`, `FetchedRelayLists` |
| `publishMuteListAtom`                              | `ReadonlyArray<Pubkey>`                       | `PlainEventReceipt`                      |
| `fetchWrapEventAtom`                               | `{ wrapId, extraRelays? }`                    | `WrapInboxEvent \| null`                 |

Chat sends and reaction adds go through `enqueueOutboxAtom` ([outbox.md](./outbox.md)); there is no `sendTextAtom`.

## Persistence and inspector

Once the first button works, add three optional fields to the config so the queue and the inbox cursor survive reloads and the diagnostics feed can be switched on:

- `outboxStore: OutboxStore.fromStringStorage(localStorage, "linky.outbox")`
- ``inboxCursorStore: InboxCursorStore.fromStringStorage(localStorage, `linky.inbox_cursor.${pubkey}`)``, keyed by pubkey so switching accounts never reuses a cursor
- `inspector: boolean`, from the Advanced → Inspector toggle ([inspector.md](./inspector.md#consuming-in-react))

`apps/web-app/src/app/hooks/useLinkstrConfigSync.ts` is the app's version of `buildConfig` with all three. `transport` is a test seam and stays unset in the app.

## Identity switches

`linkstrRuntimeAtom` is built from `linkstrConfigAtom`. Any config change (new key, new relay list, inspector toggled) closes the previous runtime with its relay pool and subscriptions, then starts new ones. Treat it as a full restart of linkstr; stream atoms restart with it.

## Inbox

Register a handler, then keep `wrapInboxAtom` mounted. The inbox opens when both a runtime and a handler exist and closes when either goes away.

```tsx
import {
  UnixSeconds,
  type InboxDelivery,
  type WrapInboxEvent,
} from "@linky/linkstr";
import {
  useAtomMount,
  useAtomSet,
  wrapInboxAtom,
  wrapInboxHandlerAtom,
} from "@linky/linkstr-react";
import React from "react";

/** Backfill window for a first session without a stored cursor. */
const LOOKBACK_SECONDS = 3 * 24 * 60 * 60;

export const useInboxSync = (
  onEvent: (event: WrapInboxEvent, delivery: InboxDelivery) => void,
) => {
  const latest = React.useRef(onEvent);
  React.useEffect(() => {
    latest.current = onEvent;
  });
  const setHandler = useAtomSet(wrapInboxHandlerAtom);
  useAtomMount(wrapInboxAtom);

  React.useEffect(() => {
    setHandler({
      since: UnixSeconds.make(Math.floor(Date.now() / 1000) - LOOKBACK_SECONDS),
      onEvent: (event, delivery) => latest.current(event, delivery),
    });
    return () => setHandler(null);
  }, [setHandler]);
};
```

Rules that follow from the atom design:

- Run **one** sync loop per app. The feed is single-consumer; fan out inside your handler (the web app's `useLinkstrInboxSync` switches on `_tag`).
- Every new handler object reopens the relay subscriptions. Register once per identity session and reach per-render state through refs, as above.
- `onEvent` may return a promise; the next event waits for it.
- `since` only matters on a first session with an empty cursor store ([inbox.md](./inbox.md#the-cursor-and-inboxcursorstore)).

`fetchWrapEventAtom` is the one-shot counterpart for notification opens.

## Outbox

`useOutboxResults(handler)` mounts the results stream for the component's lifetime. A job is acked only after your handler resolves; a rejection leaves it to be re-delivered on the next runtime build. Mount it once, high in the tree, inside a hook that owns the app callbacks:

```tsx
import type { OutboxRef, RumorId } from "@linky/linkstr";
import { useOutboxResults } from "@linky/linkstr-react";

interface OutboxSyncCallbacks {
  /** App callback: mark the local row named by `ref` as sent. */
  markSent: (ref: OutboxRef, rumorId: RumorId) => Promise<void>;
  /** App callback: record the permanent failure on the row. */
  logFailure: (ref: OutboxRef, reason: string, detail: string) => Promise<void>;
}

export const useOutboxSync = ({
  markSent,
  logFailure,
}: OutboxSyncCallbacks) => {
  useOutboxResults(async (result) => {
    if (result._tag === "OutboxJobSucceeded") {
      await markSent(result.ref, result.receipt.rumorId);
      return;
    }
    await logFailure(result.ref, result.reason, result.detail);
  });
};
```

The web app's version is `applyOutboxResult` in `apps/web-app/src/app/hooks/messages/outboxResults.ts`; [outbox.md](./outbox.md) explains results and acks.

## Independent profile lookups

A function atom holds one current operation and result. Calling the same atom again interrupts its previous operation; separate callers sharing that atom do not have independent promises. For profile lookups owned by a separate component, create one atom per mounted consumer:

```tsx
const [profileLookup] = React.useState(createFetchProfilesAtom);
const fetchProfiles = useAtomSet(profileLookup, { mode: "promiseExit" });
```

Import `createFetchProfilesAtom` from `@linky/linkstr-react`. Serialize batches within that consumer so two calls to its atom do not overlap. The existing `fetchProfilesAtom` remains a shared single-operation atom.

## Profile watch

`watchedProfilesAtom` (the pubkey set), `profileWatchHandlerAtom`, and `profileWatchAtom` follow the inbox pattern; changing the set resubscribes without rebuilding the runtime. See [profiles.md](./profiles.md) and `apps/web-app/src/app/hooks/useLinkstrProfileSync.ts`.

## Relay health and inspector

- `relayHealthAtom`: `Result<ReadonlyMap<string, RelayHealthState>>`, read with `useAtomValue` and `Result.isSuccess` ([relay-health.md](./relay-health.md#reading-it-in-react)).
- `inspectorHandlerAtom` + `inspectorEventsAtom`: set `{ onEvent }` and mount the atom; it streams only when `config.inspector` is true ([inspector.md](./inspector.md#consuming-in-react)).

## Testing

`@linky/linkstr-react/testing` exports `configWith`, `settle`, `fakeTransport`, `fakeTransportLayer`, `relayA`, `relayB`, and re-exports `makeIdentity`. Tests use a bare `Registry.make()` instead of rendering; see [testing.md](./testing.md#linkylinkstr-reacttesting).

## Related

- [getting-started.md](./getting-started.md)
- [inbox.md](./inbox.md), [outbox.md](./outbox.md)
- [testing.md](./testing.md)
