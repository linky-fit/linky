# App messages

`AppMessages` carries private messages whose format your app defines itself. Each message is one gift-wrapped kind 24137 rumor, sent to the recipient only, tagged with your app's `AppNamespace` so apps sharing an identity and relays ignore each other's messages. It arrives through the [inbox](./inbox.md) as `AppMessageReceived`. For public, addressable app state use [app data](./plain-events.md#app-data-nip-78) instead.

## Typed channel

`appMessageChannel(app, schema)` binds a namespace to an effect `Schema`. Its `draft` encodes a value as JSON into an `AppMessageDraft`; its `decode` turns an `AppMessageReceived` of that namespace back into the value, or `Option.none()` when the JSON does not match the schema.

```ts
import { Effect, Option, Schema } from "effect";
import {
  AppMessages,
  AppNamespace,
  appMessageChannel,
  type Pubkey,
  type WrapInboxEvent,
} from "@linky-fit/linkstr";

const ShopMessage = Schema.Union(
  Schema.Struct({
    v: Schema.Literal(1),
    type: Schema.Literal("PaymentRecord"),
    paymentId: Schema.String,
    amountCzk: Schema.Int,
  }),
  Schema.Struct({
    v: Schema.Literal(1),
    type: Schema.Literal("EmployeeRemoved"),
  }),
);
const shop = appMessageChannel(AppNamespace.make("myshop"), ShopMessage);

const report = (owner: Pubkey) =>
  Effect.flatMap(AppMessages, (messages) =>
    messages.send(
      shop.draft(owner, {
        v: 1,
        type: "PaymentRecord",
        paymentId: "p-1",
        amountCzk: 12300,
      }),
    ),
  );

const onInbox = (event: WrapInboxEvent): void => {
  if (event._tag !== "AppMessageReceived") return;
  const message = shop.decode(event);
  if (Option.isSome(message)) {
    // event.from sent message.value; apply it idempotently by event.messageId.
  }
};
```

`send` resolves with an `AppMessageReceipt` once a relay accepted the wrap and fails with `WrapNotDelivered` when none did. For a message that must survive going offline, enqueue `{ _tag: "appMessage", draft }` on the [outbox](./outbox.md) instead; every retry publishes the same rumor id. Pass your own `clientId` to `draft` to recognise the same message sent twice.

Nothing about the sender is implied beyond the authenticated `from`: check that it is someone your app trusts before acting on a message. The inbox replays messages after restarts, so apply them idempotently by `messageId`.

The content can carry secrets (tokens, keys). linkstr keeps it out of inspector rows; keep it out of your own logs.

## Wire format

| Kind  | Tags, in order                                                                | Content            |
| ----- | ----------------------------------------------------------------------------- | ------------------ |
| 24137 | `p` to, `p` author, `client` clientId, `linky` `app_message`, `app` namespace | the draft's string |

One recipient copy, no self copy and no push marker ([wire conventions](./concepts.md#wire-conventions)). The decoder drops a rumor without the `linky` marker, without a valid `app` tag, authored by you, or not tagging you, as `invalid-app-message`.
