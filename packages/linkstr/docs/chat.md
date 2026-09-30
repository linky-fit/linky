# Chat

`Chat` sends one-to-one messages: text, an encrypted image or file, a cashu token, and edits of an earlier text message. Text, token and edit messages are NIP-17 kind 14 rumors; file messages are kind 15. Every message is gift-wrapped (kind 1059) twice — one wrap to the peer, one to yourself — so your other devices see the echo.

## Quick example

Direct send, for one-shot environments:

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
} from "@linky-fit/linkstr";

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

For a message that must survive going offline, enqueue `{ _tag: "chat.text", draft }` on the [outbox](./outbox.md#enqueue-deliver-observe) instead, with your own `clientId` so the echo and the result can be matched to the optimistic row. Then there are three separate facts, in this order: **enqueued** (the `EnqueueReceipt` returns; `rumorId` is fixed, nothing has reached a relay), **accepted by a relay** (later, on the outbox results stream, as a `ChatMessageReceipt` or `MessageEditReceipt` keyed by your `ref`), **processed by the peer** (only a [seen receipt](./seen-receipts.md) tells you that).

## Sending

| Draft               | Fields                                                                                                                     | Method      | Outbox op    |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------ |
| `TextMessageDraft`  | `to: Pubkey`, `content: MessageText`, `replyTo?: RumorId`, `root?: RumorId`, `clientId?: ClientId`, `sentAt?: UnixSeconds` | `sendText`  | `chat.text`  |
| `TokenMessageDraft` | `to`, `token: CashuTokenText`, `replyTo?`, `root?`, `clientId?`, `sentAt?`                                                 | `sendToken` | `chat.token` |
| `ImageMessageDraft` | `to`, `image: PrivateImage`, `replyTo?`, `root?`, `clientId?`, `sentAt?`                                                   | `sendImage` | `chat.image` |
| `EditMessageDraft`  | `to`, `editOf: RumorId`, `content: MessageText`, `clientId?`, `sentAt?`                                                    | `edit`      | `chat.edit`  |

- `clientId` is generated when omitted. Pass your own when an optimistic local row already exists; the echo (`OwnChatMessageConfirmed.clientId`) and the outbox result carry it back.
- `replyTo` alone marks a reply to a top-level message; add `root` when replying inside a thread. Edits carry no reply context.
- `MessageText` is a non-empty trimmed string; `CashuTokenText` must parse with `parseCashuToken`. Both throw from `.make` on bad input, so decode user input with `Schema.decodeUnknownEither` instead.

`ChatMessageReceipt` carries `rumorId`, `clientId`, `sentAt`, `selfCopy` and `recipientCopy`; `MessageEditReceipt` adds `editOf`. A receipt only exists when the recipient copy was accepted.

Push: `sendText` and `sendImage` tag the recipient's wrap with `["linky", "push"]` so a push server can notify. `sendToken` and `edit` do not; follow a token send with a push-marked [payment notice](./payment-kinds.md#payment-notices) when the recipient should be woken up.

### Images and files

Linkstr neither encrypts nor uploads. Before building an `ImageMessageDraft`, encrypt the file with AES-GCM, upload the ciphertext to a Blossom server using `makeBlossomUploadAuthHeader` ([http-auth.md](./http-auth.md)), and record both hashes. `PrivateImage` holds the ciphertext `url`, MIME `fileType`, `encryptionAlgorithm: "aes-gcm"`, `key` (64 lowercase hex) and `nonce` (24 lowercase hex), `encryptedSha256` of the stored bytes and `originalSha256` of the plaintext, `encryptedSize`, `storageEncoding` (`"base64"` or `"raw"`), and optional `fileName` plus `width` / `height` (both or neither: images yes, PDFs no).

### Cashu tokens

`parseCashuToken(raw)` returns `{ amount, mint, unit }` for a standard `cashuA` / `cashuB` token, else `null`; `extractWholeCashuToken(text)` strips a `cashu:` / `web+cashu://` prefix and returns the token when the whole input is one token, else `null`. On the wire a token message is a plain kind 14 whose content is the token; the decoder classifies it as `TokenBody`.

## Wire format

Every send is a NIP-17 rumor delivered as two gift wraps, self and peer, published in parallel ([wire conventions](./concepts.md#wire-conventions)).

| Send  | Kind | Tags, in order                                                                                                                                                                                                                                                                               | Content                               |
| ----- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| text  | 14   | `p` to, `p` author, `client`, reply tags                                                                                                                                                                                                                                                     | the text                              |
| token | 14   | as text                                                                                                                                                                                                                                                                                      | the whole `cashuA…` / `cashuB…` token |
| edit  | 14   | `p` to, `p` author, `edited_from` editOf, `client`                                                                                                                                                                                                                                           | the replacement text                  |
| file  | 15   | `p` to, `p` author, `client`, `file-type`, `encryption-algorithm` (`aes-gcm`), `decryption-key`, `decryption-nonce`, `x` encryptedSha256, `ox` originalSha256, `size`, `dim` `<w>x<h>` (images only), `name` (when a file name is set), `encoding` `base64` (when stored base64), reply tags | the Blossom url of the ciphertext     |

- Reply tags are `["e", root ?? replyTo, "", "root"]` then `["e", replyTo, "", "reply"]`, present only when `replyTo` is set. Marker-less `e` tags from other clients are tolerated: the first is root and, with two or more, the last is the reply.
- A token message has no tag of its own; the receiver classifies by content.
- Push marker on the recipient wrap: text and file yes, token and edit no.

## Receiving

Chat facts arrive on the wrap inbox ([inbox.md](./inbox.md)). Edits are not a separate event: both facts carry `editOf`.

| Tag                       | Fields                                                                                                                                              | Meaning                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `ChatMessageReceived`     | `messageId: RumorId`, `from: Pubkey`, `body: MessageBody`, `replyTo: RumorId \| null`, `root: RumorId \| null`, `editOf: RumorId \| null`, `sentAt` | a peer's message; `editOf` set = a new version of that id |
| `OwnChatMessageConfirmed` | `messageId`, `to: Pubkey`, `body`, `replyTo`, `root`, `editOf`, `clientId: ClientId \| null`, `sentAt`                                              | your own message seen on a relay (echo or another device) |

`MessageBody` is `TextBody { text }`, `ImageBody { image: PrivateImage }` or `TokenBody { token: CashuTokenText }`.

```ts
import type {
  MessageBody,
  Pubkey,
  RumorId,
  UnixSeconds,
  WrapInboxEvent,
} from "@linky-fit/linkstr";

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

What to do with `OwnChatMessageConfirmed` is your storage policy: match a pending row by `clientId`, then by `messageId`; an echo that matches nothing is a message sent from another of your devices, which a consumer without shared storage must insert.

Drop reasons this codec adds ([the full table](./inbox.md#authentication-and-drop-reasons)): `invalid-message` (not addressed to you, or no peer `p` tag on your own copy), `invalid-image` (a kind 15 missing or malforming a required tag), `invalid-edit` (`edited_from` is not a rumor id), `empty-message`, `nested-payload` (the content is itself a NIP-44 ciphertext for you).

## Errors

Direct sends fail with `RecipientNotReached` or `NoRelayReachable`; queued sends surface only `OutboxJobFailed` on the results stream. See [the error table](./concepts.md#errors).

## Related

- [outbox.md](./outbox.md) — enqueue, results stream, `OutboxRef`
- [reactions.md](./reactions.md) — reacting to a `messageId`
- [seen-receipts.md](./seen-receipts.md) — read cursors for a conversation
- [http-auth.md](./http-auth.md) — Blossom upload auth for attachments
