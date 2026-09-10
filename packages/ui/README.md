# @linky/ui

Linky's next component library, extracted from the approved `linky-design` demo. It uses Tamagui 2.7.7, Manrope, slate backgrounds, teal actions, circular portraits, and the demo's spacing. It replaces the retired UI library and does not import application code. The product apps keep their original design.

## Use

```tsx
import { UIProvider, Stack, WalletBalance } from "@linky/ui";

export function WalletPreview() {
  return (
    <UIProvider mode="dark">
      <Stack backgroundColor="$background" padding="$page">
        <WalletBalance
          label="Available balance"
          value="84,250"
          unit="sats"
          receiveLabel="Receive"
          sendLabel="Send"
          onReceive={() => {
            /* Open the app's receive route. */
          }}
          onSend={() => {
            /* Open the app's send route. */
          }}
        />
      </Stack>
    </UIProvider>
  );
}
```

Load Manrope before rendering. Web can load `@fontsource/manrope` weights 400, 600, and 700. Native apps should register `Manrope`, `ManropeSemiBold`, and `ManropeBold`. `UIProvider` defaults to dark; pass `mode="light"` to switch. Config and tokens also have dedicated `@linky/ui/config` and `@linky/ui/tokens` exports. Use one Linky UI config per app entry point.

## Component inventory

| Area        | Exports                                                                                                   | Demo patterns                                                                       |
| ----------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Foundations | UIProvider, Stack, Row, Surface, Divider, Text, Icon                                                      | Theme roles, typography, flat surfaces, Lucide icons                                |
| Controls    | Button, IconButton, Chip, SegmentedControl                                                                | Primary, secondary, ghost, destructive, busy, disabled, filters, appearance         |
| Fields      | TextField, SearchField, AmountField, SelectField                                                          | Labels, hints, errors, multiline input, search clear, amount entry, group selection |
| People      | Avatar, PersonShortcut, UnreadBadge, ContactRow, ListRow                                                  | Portraits and initials, recent people, conversations, settings rows                 |
| Wallet      | Amount, WalletBalance, ActivityRow, SectionHeader, DateGroup, StatusBadge                                 | Balance actions, dated activity, completed/pending/failed states                    |
| Chat        | MessageBubble, ReplyPreview, Reaction, MessageActions, PaymentMessage, MessageComposer, ChatPaymentAction | Both directions, metadata, replies, reactions, payment/request cards, composing     |
| Attachments | AttachmentCard, AttachmentTray                                                                            | Image/document preview, controlled staged files and removal                         |
| Navigation  | ScreenHeader, ConversationHeader, BottomNav                                                               | Centered titles, chat headers, floating navigation content                          |
| Feedback    | Notice, EmptyState, LoadingState, Toast, Dialog                                                           | Offline/error feedback, empty lists, loading, dismissal, modal focus                |
| Payments    | PaymentResult, QRCodeCard                                                                                 | Distinct outcomes, encoded receive requests, action slots                           |

Every component exports its props interface. `Text` accepts `variant="caption"`, `"label"`, `"body"`, `"title"`, `"heading"`, `"display"`, `"amount"`, `"message"`, or `"metadata"`. Layout components and buttons accept Tamagui style props for composition. Standard buttons are at least 48px tall; compact and icon controls are at least 44px.

`Avatar` accepts `name`, optional `uri`, and `size="small" | "regular" | "large"` for 32px, 44px, and 68px. It falls back to initials, including failed image loads. Avatars are decorative beside a person's name; supply `label` for a standalone accessible portrait.

## State and ownership

Consumers supply translated labels, locale-formatted amount strings, units, delivery text, payment state, and callbacks. `PaymentMessage`, `ActivityRow`, and `PaymentResult` accept `state="completed" | "pending" | "failed"`; state determines the status icon and color. The supplied label must describe the actual outcome. A request uses `PaymentMessage kind="request"`. Never label a pending or failed payment as paid.

Inputs, selections, reactions, and message drafts are controlled. `MessageComposer` blocks sending blank text unless `canSend` explicitly allows an attachment-only message. `disabled` and `sending` block submission. It does not clear a draft or claim delivery after a callback. `Button loading` disables activation and accepts a `loadingLabel`.

`Dialog` owns focus trapping, Escape/backdrop dismissal, opener focus restoration on web, and hardware back on Android. Keep it mounted and control `open`. Its description and close label are required. `SelectField` uses the same dialog for choosing an option.

File picking, uploads, object-URL lifetime, QR scanning, clipboard access, amount validation, locale formatting, payments, networking, routing, and storage belong to consumers. `QRCodeCard` only encodes the supplied value. No sample payment or personal data is bundled with the library. The preview book owns its fictional fixtures.

Apps own viewport sizing, scrolling, safe-area insets, keyboard avoidance, and positioning `BottomNav`. The library contains no demo CSS or HTML-only elements. Tamagui and React Native components provide the shared rendering; `dialogBehavior.web.ts` restores browser focus. `growing-input.web.tsx` measures textareas and responds to width changes; native inputs use content-size events. Amount entry keeps all digits visible, and the chat composer grows up to 144px before scrolling. Native device behavior still needs device validation.

## Preview and checks

From the repository root:

```sh
bun run --filter @linky/ui-book dev
bun run --filter @linky/ui typecheck
bun run --filter @linky/ui test
```

The preview book imports these exports directly and runs with local example state, without Linky services.

`ChatPaymentAction` reproduces the composer’s Request and Pay pills. Pass `kind="request"` or `kind="pay"`, a translated label as children, and `onPress`. Place these in `MessageComposer.paymentActions`. The composer uses its outer teal border for input focus. Enter sends; Shift+Enter inserts a newline, and IME composition does not submit.
