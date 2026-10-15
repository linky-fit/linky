# Chat

`Chat` sends one-to-one messages: text, an encrypted image or file, a cashu token, edits of an earlier text message, and deletions of any message. Text, token and edit messages are NIP-17 kind 14 rumors; file messages are kind 15; a deletion is a NIP-09 kind 5 request. Every message is gift-wrapped (kind 1059) twice, once to the peer and once to yourself, so your other devices see the echo.

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

| Draft                | Method          | Outbox op     |
| -------------------- | --------------- | ------------- |
| `TextMessageDraft`   | `sendText`      | `chat.text`   |
| `TokenMessageDraft`  | `sendToken`     | `chat.token`  |
| `ImageMessageDraft`  | `sendImage`     | `chat.image`  |
| `EditMessageDraft`   | `edit`          | `chat.edit`   |
| `DeleteMessageDraft` | `deleteMessage` | `chat.delete` |

- `clientId` is generated when omitted. Pass your own when an optimistic local row already exists; the echo (`OwnChatMessageConfirmed.clientId`) and the outbox result carry it back.
- `replyTo` alone marks a reply to a top-level message; add `root` when replying inside a thread. Edits carry no reply context.
- `MessageText` and `CashuTokenText` throw from `.make` on bad input; decode user input with `Schema.decodeUnknownResult` instead.

A receipt (`ChatMessageReceipt`, `MessageEditReceipt` for edits, `MessageDeletionReceipt` for deletions) only exists when the recipient copy was accepted.

A deletion names the message by `deleteOf` (its rumor id) and `deleteOfKind` (`text` for kind 14, `image` for kind 15). Either participant may delete any message of the conversation; whether a peer's deletion of your message is honoured is your policy. Apply it to the local row when you enqueue the deletion, not when the receipt arrives; keeping a placeholder in the message's place is up to the consumer.

`sendToken` delivers **recipient first**: the self copy is published only after a relay accepted the recipient copy, so an own echo of a token message always means the recipient's copy reached a relay. A token send no relay accepted for the recipient therefore fails with `NoRelayReachable`, never `RecipientNotReached`.

Push: `sendText` and `sendImage` tag the recipient's wrap with `["linky", "push"]` so a push server can notify. `sendToken`, `edit` and `deleteMessage` do not; follow a token send with a push-marked [payment notice](./payment-kinds.md#payment-notices) when the recipient should be woken up.

### Images and files

Linkstr neither encrypts nor uploads. Before building an `ImageMessageDraft`, encrypt the file with AES-GCM, upload the ciphertext to a Blossom server using `makeBlossomUploadAuthHeader` ([http-auth.md](./http-auth.md)), and fill `PrivateImage` with the ciphertext url, the key and nonce, and the hashes of both the stored bytes and the plaintext. `width` and `height` come together or not at all: images yes, PDFs no.

### Cashu tokens

A token message is a plain kind 14 whose content is the token; the receiver classifies it as `TokenBody`. `parseCashuToken` and `extractWholeCashuToken` (which strips a `cashu:` / `web+cashu://` prefix) validate user input before you build the draft.

`token` also takes a `PaymentRequestPayloadText`, the NUT-18 payment payload JSON a payer sends to a payment request's `nostr` transport; the receiver gets it as a `TextBody`. Set `recipientRelays` to the relays of the request's nprofile: the recipient copy then goes to them as well as to your write relays, as one gift wrap, so the payee sees one message wherever it reads. The self copy stays on your write relays.

## Wire format

Every send is a NIP-17 rumor delivered as two gift wraps, self and peer, published in parallel, except a token: its recipient copy goes first ([wire conventions](./concepts.md#wire-conventions)).

| Send   | Kind | Tags, in order                                                                                                                                                                                                                                                                               | Content                               |
| ------ | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| text   | 14   | `p` to, `p` author, `client`, reply tags                                                                                                                                                                                                                                                     | the text                              |
| token  | 14   | as text                                                                                                                                                                                                                                                                                      | the whole `cashuA…` / `cashuB…` token |
| edit   | 14   | `p` to, `p` author, `edited_from` editOf, `client`                                                                                                                                                                                                                                           | the replacement text                  |
| delete | 5    | `p` to, `p` author, `e` deleteOf, `k` `14` or `15`, `client`                                                                                                                                                                                                                                 | empty                                 |
| file   | 15   | `p` to, `p` author, `client`, `file-type`, `encryption-algorithm` (`aes-gcm`), `decryption-key`, `decryption-nonce`, `x` encryptedSha256, `ox` originalSha256, `size`, `dim` `<w>x<h>` (images only), `name` (when a file name is set), `encoding` `base64` (when stored base64), reply tags | the Blossom url of the ciphertext     |

- Reply tags are `["e", root ?? replyTo, "", "root"]` then `["e", replyTo, "", "reply"]`, present only when `replyTo` is set. Marker-less `e` tags from other clients are tolerated: the first is root and, with two or more, the last is the reply.
- A token message has no tag of its own; the receiver classifies by content.
- Push marker on the recipient wrap: text and file yes, token, edit and delete no.
- A deletion is a NIP-09 request confined to the conversation. Its `k` tag is what tells it from a reaction retraction, which is also kind 5 ([reactions.md](./reactions.md#wire-format)): a kind 5 rumor whose `k` tag names `14` or `15` decodes here, any other kind 5 decodes as a retraction.

## Receiving

Chat facts arrive on the wrap inbox ([inbox.md](./inbox.md)): `ChatMessageReceived` is a peer's message, `OwnChatMessageConfirmed` your own message seen on a relay (echo or another device), `ChatMessageDeleted` a peer's request to drop the message `deleteOf`, and `OwnChatMessageDeletionConfirmed` the echo of your own deletion (`clientId` is null when another of your devices sent it). Edits are not a separate event: both facts carry `editOf`, and a set `editOf` means a new version of that id. Both facts also carry the sender's `clientId` (null when the rumor has no valid `client` tag): two rumors from one sender with one `clientId` are the same message published twice, for example by two of the sender's devices, each with its own `sentAt` and therefore its own `messageId`. `body` is a `MessageBody`: `TextBody`, `ImageBody` or `TokenBody`.

```ts
import type {
  ClientId,
  MessageBody,
  Pubkey,
  RumorId,
  UnixSeconds,
  WrapInboxEvent,
} from "@linky-fit/linkstr";

interface ChatStore {
  // Placeholders for your persistence layer.
  /** Skips a message already stored by `id`, or by `from` + `clientId`. */
  insertIncoming: (
    id: RumorId,
    from: Pubkey,
    clientId: ClientId | null,
    body: MessageBody,
  ) => void;
  applyEdit: (editOf: RumorId, body: MessageBody, sentAt: UnixSeconds) => void;
  markSent: (clientIdOrMessageId: string) => void;
  /** Replaces the message with a placeholder and drops its reactions; a no-op when it is not stored. */
  markDeleted: (messageId: RumorId, peer: Pubkey) => void;
}

export const chatHandler =
  (store: ChatStore) =>
  (event: WrapInboxEvent): void => {
    switch (event._tag) {
      case "ChatMessageReceived":
        if (event.editOf !== null)
          return store.applyEdit(event.editOf, event.body, event.sentAt);
        return store.insertIncoming(
          event.messageId,
          event.from,
          event.clientId,
          event.body,
        );
      case "OwnChatMessageConfirmed":
        return store.markSent(event.clientId ?? event.messageId);
      case "ChatMessageDeleted":
        return store.markDeleted(event.deleteOf, event.from);
      case "OwnChatMessageDeletionConfirmed":
        return store.markDeleted(event.deleteOf, event.to);
      default:
        return;
    }
  };
```

What to do with `OwnChatMessageConfirmed` is your storage policy: match a pending row by `clientId`, then by `messageId`; an echo that matches nothing is a message sent from another of your devices, which a consumer without shared storage must insert. A deletion only names a rumor id: look the message up within the conversation with `from` (or `to`), so a peer can never delete a message of another conversation.

Drop reasons this codec adds ([the full table](./inbox.md#authentication-and-drop-reasons)): `invalid-message` (not addressed to you, or no peer `p` tag on your own copy), `invalid-image` (a kind 15 missing or malforming a required tag), `invalid-edit` (`edited_from` is not a rumor id), `invalid-deletion` (a deletion whose `e` tag is not a rumor id), `empty-message`, `nested-payload` (the content is itself a NIP-44 ciphertext for you).

## Errors

Direct sends fail with `RecipientNotReached` or `NoRelayReachable`; queued sends surface only `OutboxJobFailed` on the results stream. See [the error table](./concepts.md#errors).
