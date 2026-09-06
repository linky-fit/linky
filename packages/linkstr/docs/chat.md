# Chat

`Chat` sends one-to-one messages: text, an encrypted image or file, a cashu token, and edits of an earlier text message. Text, token, and edit messages are NIP-17 kind 14 rumors; image messages are kind 15. Every message is gift-wrapped (kind 1059) twice — one wrap to the peer, one to yourself — so your other devices see the echo. In the app, chat sends go through the outbox (durable, retried across reloads); call the service directly only from one-shot environments.

## Quick example

Prerequisites: a `NostrSecretKey`, relay urls, and the peer's `Pubkey` — see [getting-started.md](./getting-started.md).

Headless (service worker, scripts):

```ts
import { Effect } from "effect";
import {
  Chat,
  MessageText,
  TextMessageDraft,
  runLinkstr,
  type NostrSecretKey,
  type Pubkey,
  type RelayUrl,
} from "@linky/linkstr";

const sendText = (
  secretKey: NostrSecretKey,
  relays: ReadonlyArray<RelayUrl>,
  peer: Pubkey,
  text: string,
) =>
  runLinkstr(
    { secretKey, readRelays: relays, writeRelays: relays },
    Effect.gen(function* () {
      const chat = yield* Chat;
      return yield* chat.sendText(
        new TextMessageDraft({ to: peer, content: MessageText.make(text) }),
      );
    }),
  );
```

The promise resolves with a `ChatMessageReceipt` once a relay accepted the peer's copy. `receipt.rumorId` is the message id every device agrees on.

React — the app's path, through the outbox. There is no `sendTextAtom`; enqueue a `chat.*` operation with `enqueueOutboxAtom`. `ChatStore` stands in for your own persistence:

```ts
import {
  ClientId,
  MessageText,
  OutboxRef,
  TextMessageDraft,
  type Pubkey,
  type RumorId,
} from "@linky/linkstr";
import { enqueueOutboxAtom, useAtomSet } from "@linky/linkstr-react";
import { Exit } from "effect";

interface ChatStore {
  /** Placeholder: insert an optimistic pending row and return its local id. */
  insertPending: (
    peer: Pubkey,
    text: MessageText,
    clientId: ClientId,
  ) => string;
}

export const useSendText = (store: ChatStore) => {
  const enqueueOutbox = useAtomSet(enqueueOutboxAtom, { mode: "promiseExit" });

  return async (peer: Pubkey, text: string): Promise<RumorId | null> => {
    const content = MessageText.make(text);
    const clientId = ClientId.make(crypto.randomUUID());
    const localRowId = store.insertPending(peer, content, clientId);
    const exit = await enqueueOutbox({
      op: {
        _tag: "chat.text",
        draft: new TextMessageDraft({ to: peer, content, clientId }),
      },
      ref: OutboxRef.make(`message:${localRowId}`),
    });
    return Exit.isSuccess(exit) ? exit.value.rumorId : null;
  };
};
```

Three separate facts, in this order:

1. **Enqueued** — `Exit.isSuccess(exit)`. The job is persisted and `rumorId` is fixed; nothing has reached a relay yet.
2. **Accepted by a relay** — arrives later on the outbox results stream (`useOutboxResults`) as a `ChatMessageReceipt` or `MessageEditReceipt` keyed by your `ref` ([outbox.md](./outbox.md)).
3. **Processed by the peer** — only a [seen receipt](./seen-receipts.md) tells you that.

## Sending

| Draft               | Fields                                                                                                                     | Service     | Outbox op    |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------ |
| `TextMessageDraft`  | `to: Pubkey`, `content: MessageText`, `replyTo?: RumorId`, `root?: RumorId`, `clientId?: ClientId`, `sentAt?: UnixSeconds` | `sendText`  | `chat.text`  |
| `TokenMessageDraft` | `to`, `token: CashuTokenText`, `replyTo?`, `root?`, `clientId?`, `sentAt?`                                                 | `sendToken` | `chat.token` |
| `ImageMessageDraft` | `to`, `image: PrivateImage`, `replyTo?`, `root?`, `clientId?`, `sentAt?`                                                   | `sendImage` | `chat.image` |
| `EditMessageDraft`  | `to`, `editOf: RumorId`, `content: MessageText`, `clientId?`, `sentAt?`                                                    | `edit`      | `chat.edit`  |

- `clientId` is generated when omitted. Pass your own when an optimistic local row already exists; the echo (`OwnChatMessageConfirmed.clientId`) and the outbox result carry it back.
- `replyTo` alone marks a reply to a top-level message; add `root` when replying inside a thread. Edits carry no reply context.
- `MessageText` is a non-empty trimmed string; `CashuTokenText` must parse with `parseCashuToken`. Both throw from `.make` on bad input, so decode user input with `Schema.decodeUnknownEither` instead.

`ChatMessageReceipt` carries `rumorId`, `clientId`, `sentAt`, `selfCopy`, and `recipientCopy`; `MessageEditReceipt` adds `editOf`. Each `WrapDelivery` lists `acceptedBy` / `rejectedBy` relays, and `.accepted` is true when at least one relay took the wrap. A receipt only exists when the recipient copy was accepted.

Push: `sendText` and `sendImage` tag the recipient's wrap with `["linky", "push"]` so the push server can notify. `sendToken` and `edit` do not; a token send is followed by a push-marked payment notice instead (see [payment-notices.md](./payment-notices.md)).

### Images and files

Linkstr neither encrypts nor uploads. Before building an `ImageMessageDraft`, encrypt the file with AES-GCM, upload the ciphertext to a Blossom server using `makeBlossomUploadAuthHeader` ([http-auth.md](./http-auth.md)), and record both hashes. The app's adapter for this is [`apps/web-app/src/app/lib/privateImageMessage.ts`](../../../apps/web-app/src/app/lib/privateImageMessage.ts); its output is a `PrivateImage`: the ciphertext `url`, MIME `fileType`, `key` and `nonce` as lowercase hex, `encryptedSha256` of the stored bytes and `originalSha256` of the plaintext, `encryptedSize`, `storageEncoding` (`"base64"` or `"raw"`), and optional `fileName` plus `width`/`height` (both or neither: images yes, PDFs no).

### Cashu tokens

`parseCashuToken(raw)` returns `{ amount, mint, unit }` for a standard `cashuA`/`cashuB` token, else `null`; `extractWholeCashuToken(text)` strips a `cashu:` / `web+cashu://` prefix and returns the token when the whole input is one token, else `null`. On the wire a token message is a plain kind 14 whose content is the token; the decoder classifies it as `TokenBody`.

## Receiving

Chat facts arrive on the wrap inbox ([inbox.md](./inbox.md)). Edits are not a separate event: both facts carry `editOf`.

| Tag                       | Fields                                                                                                                                              | Meaning                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `ChatMessageReceived`     | `messageId: RumorId`, `from: Pubkey`, `body: MessageBody`, `replyTo: RumorId \| null`, `root: RumorId \| null`, `editOf: RumorId \| null`, `sentAt` | a peer's message; `editOf` set = a new version of that id |
| `OwnChatMessageConfirmed` | `messageId`, `to: Pubkey`, `body`, `replyTo`, `root`, `editOf`, `clientId: ClientId \| null`, `sentAt`                                              | your own message seen on a relay (echo or another device) |

`MessageBody` is `TextBody { text }`, `ImageBody { image: PrivateImage }`, or `TokenBody { token: CashuTokenText }`.

```ts
import type {
  MessageBody,
  Pubkey,
  RumorId,
  UnixSeconds,
  WrapInboxEvent,
} from "@linky/linkstr";

interface ChatStore {
  // Placeholders for your persistence layer.
  insertIncoming: (id: RumorId, from: Pubkey, body: MessageBody) => void;
  applyEdit: (editOf: RumorId, body: MessageBody, sentAt: UnixSeconds) => void;
  markSent: (clientIdOrMessageId: string) => void;
}

export const chatHandler =
  (store: ChatStore) =>
  (event: WrapInboxEvent): void => {
    switch (event._tag) {
      case "ChatMessageReceived":
        if (event.editOf !== null)
          return store.applyEdit(event.editOf, event.body, event.sentAt);
        return store.insertIncoming(event.messageId, event.from, event.body);
      case "OwnChatMessageConfirmed":
        return store.markSent(event.clientId ?? event.messageId);
      default:
        return;
    }
  };
```

What to do with `OwnChatMessageConfirmed` is your storage policy. The web app only reconciles — match a pending row by `clientId`, then by `messageId`, and drop an echo that matches nothing — because all of its devices share one Evolu database, so the sending device's row already reaches the others. A consumer without shared storage must instead insert unmatched echoes as messages sent from another device.

Wraps that fail chat decoding surface as `WrapDropped` with one of: `invalid-message` (not addressed to you, or no peer p-tag on your own copy), `invalid-image`, `invalid-edit`, `empty-message`, `nested-payload` (the content is itself a NIP-44 ciphertext), `unsupported-kind`.

## Errors

| Tag                    | When                                                      | What to do                                                           |
| ---------------------- | --------------------------------------------------------- | -------------------------------------------------------------------- |
| `RecipientNotReached`  | your self copy landed, no relay accepted the peer's copy  | the peer will not see it; retry — the outbox does this for you       |
| `NoRelayReachable`     | no relay accepted either wrap                             | offline or all write relays down; retry later                        |
| `OutboxJobFailed`      | outbox terminal: `identity-changed` or `unexpected-error` | mark the local row failed; a delivery error never reaches this state |
| `LinkstrNotConfigured` | React only: `linkstrConfigAtom` is null                   | user is logged out; do not send                                      |

Both delivery errors carry `rumorId`, `clientId`, `sentAt`, `selfCopy`, and `recipientCopy`.

## Related

- [outbox.md](./outbox.md) — enqueue, results stream, `OutboxRef`
- [inbox.md](./inbox.md) — opening the wrap inbox and delivery phases
- [reactions.md](./reactions.md) — reacting to a `messageId`
- [seen-receipts.md](./seen-receipts.md) — read cursors for a conversation
- [http-auth.md](./http-auth.md) — Blossom upload auth for images
- [../README.md](../README.md) — honest delivery and authenticated inbound
