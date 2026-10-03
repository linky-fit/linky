# @linky-fit/ui

Linky's design system: Tamagui components that render the same on React Native (Expo) and on the web through react-native-web. Components take translated labels, formatted values and callbacks; wallet, Nostr, storage and navigation logic stays in the app.

The package ships TypeScript source. Add `"@linky-fit/ui": "workspace:*"` to the consumer and let Metro or Vite compile it. Peers: `react`, `react-native`, `react-native-svg`, and on the web `react-dom` and `react-native-web`.

## Setup

Wrap the app once in `UIProvider` and pass the active color mode. The provider does not pick or store the mode; the app decides between `"light"` and `"dark"`.

```tsx
import { Button, Screen, Text, UIProvider } from "@linky-fit/ui";

export function App() {
  return (
    <UIProvider mode="dark">
      <Screen>
        <Text variant="heading">Wallet</Text>
        <Button icon="Send">Pay</Button>
      </Screen>
    </UIProvider>
  );
}
```

### Expo

Load Manrope before rendering. Native fonts have no weight axis, so each weight is a family named after `@expo-google-fonts/manrope`:

```tsx
import {
  Manrope_400Regular,
  Manrope_600SemiBold,
  Manrope_700Bold,
  useFonts,
} from "@expo-google-fonts/manrope";

const [loaded] = useFonts({
  Manrope_400Regular,
  Manrope_600SemiBold,
  Manrope_700Bold,
});
```

### Vite (react-native-web)

Add the plugin before the React plugin. It aliases `react-native` to `react-native-web`, prefers `.web.*` files, dedupes React, defines `__DEV__`, `global` and `process.env` for Tamagui and React Native, and compiles the JSX that `react-native-qrcode-svg` publishes as `.js`.

```ts
import react from "@vitejs/plugin-react-swc";
import { linkyUi } from "@linky-fit/ui/vite";

export default defineConfig({ plugins: [linkyUi(), react()] });
```

On the web, import `@linky-fit/ui/manrope.css` once (from CSS or JS); it registers self-hosted `Manrope` for weights 400, 600 and 700, and the font stack falls back to `system-ui`. Publish `fonts/manrope/OFL.txt` with the app, e.g. at `public/licenses/Manrope-OFL.txt`.

## Tokens and themes

All values live in `src/tokens.ts`, exported whole from the package root. `@linky-fit/ui/tokens` exports the same module without loading React or Tamagui, for code such as boot screens. Components read the values as Tamagui tokens, and so should app code:

```tsx
<Card padding="$lg" gap="$sm" borderRadius="$card">
  <Text variant="label" color="$colorMuted">
    Balance
  </Text>
</Card>
```

| Group                      | Tokens                                                                                                                                                                                                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Space                      | `none` 0, `xxs` 2, `xs` 4, `sm` 8, `md` 12, `lg` 16, `xl` 20 (page gutter), `xxl` 24, `xxxl` 32, `huge` 48                                                                                                                                                  |
| Radius                     | `sm` 8, `control` 12, `card` 16, `sheet` 24, `pill` 999                                                                                                                                                                                                     |
| Size                       | `track` 6, `dot` 10, icons `iconSm` 16, `icon` 20, `iconLg` 24, `iconXl` 40, controls `controlSm` 32, `control` 44, `controlLg` 56, `avatar` 48, `row` 64, `hero` 112, `column` 160, `qr` 240, widths `sheetWidth` 520, `contentWidth` 720, `appWidth` 1240 |
| Font weight                | `regular` 400, `semibold` 600, `bold` 700                                                                                                                                                                                                                   |
| Text variants              | `caption` 12/16, `label` 14/20 semibold, `body` 16/24, `title` 18/24 bold, `heading` 22/28 bold, `display` 32/40 bold, `amount` 48/52 bold; plus `bold`, `mono` and `eyebrow` (uppercase bold caption)                                                      |
| Z-index                    | `base`, `raised`, `sticky`, `overlay`, `toast`                                                                                                                                                                                                              |
| Motion                     | transitions `fast` 150 ms, `base` 220 ms, `slow` 420 ms; web easing `standard`, `overshoot` (for `slow`)                                                                                                                                                    |
| Border, opacity and shadow | exported as `border`, `opacity` (`disabled`, `dimmed`) and `shadow` constants for props without token support                                                                                                                                               |
| Breakpoint                 | media `compact` below 961 px, `wide` from 961 px                                                                                                                                                                                                            |

Both themes have the same keys. Surfaces: `$background` (page), `$surface` (cards, sheets, toasts), `$surfaceRaised` (secondary buttons, keys), the translucent `$neutralSoft` (fields, incoming messages, chips) and `$scrim` (dims the page behind overlays). Text: `$colorStrong` (amounts, code), `$color`, `$colorSubtle`, `$colorMuted`. Each tone has a soft fill and a text color for that fill: `$accentSoft`/`$accentText`, `$dangerSoft`/`$dangerText`, `$warningSoft`/`$warningText`, `$infoSoft`/`$infoText`, plus solid `$accent` and `$danger` with `$onAccent` and `$onDanger`. Components take a `tone` of `neutral`, `accent`, `warning`, `danger` or `info`.

The config makes style values strict at the type level: color props accept theme keys only, space props reject strings that are not tokens, and size props accept tokens and percentages. Tamagui's types always accept raw numbers for space and size, so the types cannot reject them; use the tokens.

## Props

- `label` is visible text; `accessibilityLabel` names an element for assistive technology only.
- A labelled callback is a `LabeledAction` object, `{ label, onPress }`, e.g. `Notice`'s `action` and `dismiss`, `GuidedTour`'s `back`, `next` and `skip`. For icon-only buttons the `label` is the accessibility label.
- Controlled toggles and pickers take `value` and `onValueChange`; text fields keep React Native's `onChangeText` (and `onChange` on the web); pickers that fire an action without holding a value take `onSelect` or `onKeyPress`.
- Sizes come from one scale, `xs`, `sm`, `md`, `lg`, `xl`; each component takes the part it needs, mostly `sm` to `lg` (`Avatar` also `xs`, `Icon` also `xl`). `BrandMark` takes a size token.
- Every optional prop also accepts `undefined`, so callers can pass a possibly missing value through.
- `tooltip` on `Pressable`, `Button`, `IconButton` and `QRCode` is the element's `title` on the web, shown even while disabled; native ignores it.

## Components

- Layout and type: `Screen`, `Stack`, `Row`, `Card`, `Section`, `Divider`, `Text`, `ScrollView`, `ScrollList` (a vertical scroll area for `ListRow`s that does not clip their highlights), `Image`, `Spacer`, `Icon` (Lucide names listed in `icons`), `BrandMark`
- Controls: `Button` (`primary`, `secondary`, `ghost`, `accent` for inline actions, `danger`; `sm` and `md`; `loading`), `IconButton` (same variants and `loading`), `Pressable` (base for custom press targets), `Switch`, `Chip`, `OptionTile` (a selectable tile with a picture above a short label, for rows or grids of choices), `SegmentedControl`, `Stepper`, `SliderField`
- Fields: `TextField` (`multiline` renders a text area; `trailing` sits inside the field at its end, vertically centred or on the bottom row when multiline, and the text never runs under it: pass an `sm` `IconButton` such as clear or paste, or a string for a muted suffix such as a currency; an action that belongs beside the field is plain markup next to it), `SelectField` (a native `<select>` on the web, a scrolling `Sheet` on native), `RichTextInput` (a contentEditable host whose content the caller renders and reads, for editors with inline entities; a plain multiline input on native; `trailing` puts an `sm` `IconButton` such as send in its bottom trailing corner, placed like a multiline `TextField`'s), `Form` with `SubmitButton` (a real `<form>` submit on the web, so Enter submits and password managers notice it)
- Display: `Avatar` (initials, "?" without a name, a photo or a `fallback` glyph; `onError` reports a photo that failed to load), `Pill` (`sm` for caption lines and status tags), `StatusDot`, `Amount`, `CodeBlock`, `DataTable` (scrolls sideways, or shares the width between columns with `fill`), `DataValue` (a shortened value whose full text is a tooltip on the web and a disclosure on native), `Disclosure`, `TimelineRow` (a compact diagnostic event row)
- Lists: `ListRow` (settings, options, transactions, mints, relays; its content lines up with the container and the press highlight reaches into the gutter; `icon` is a small muted leading icon, `leading` takes anything else; `value` is muted text at the end, e.g. a setting's current value, labelled by a string `title`; `expanded` marks a row that shows or hides details below it), `ContactRow`
- Feedback: `Notice` (inline notices with the action under the text, and the `solid` app banner: a compact accent strip with the action at the end of its row), `Toast` (a `title`, pressable as a whole or with one action), `ToastStack`, `Spinner` (accent, or any `color`), `LoadingState`, `Progress` (`value` out of `max`, default 1, continuous or split into `segments`), `StatusLine` (a quiet full-width line for a background state such as waiting for sync, with a `busy` spinner; `rounded` when it does not span the window), `EmptyState`
- Overlays: `Dialog` (centered or full screen) and `Sheet` (a titled bottom sheet whose content scrolls). Both can hide their title from sight (`hideTitle`), trap focus, close on Escape, the overlay and Android back, and return focus to the opener on the web. Also `GuidedTour` and `SuccessOverlay` (a payment confirmation that can show the other party's `avatar`, the payment `direction`, the amount's `unit` and a `pending` spinner while the payment is in flight)
- Navigation: `TopBar`, `TabBar` (docked icon tabs with an indicator that can follow a swipe), `NavigationRail` (the full-height section column on wide screens, with a header such as the profile avatar and `footerItems` pinned to its bottom)
- Payments: `Keypad`, `QRCode` (optional centre `badge` icon), `Amount`
- Messaging: `MessageBubble`, `DaySeparator`, `ReplyPreview`, `MessageComposerFrame` (stacks a header, the app's input with its send action inside, e.g. a `RichTextInput` with `trailing`, and a footer), `MessageLink`, `LinkPreview`, `FileAttachment`, `ImageAttachment`, `AttachmentTray`, `EmojiPicker`
- Media: `MediaFrame`, `CameraPreview` (a live `getUserMedia` stream inside a `MediaFrame` on the web), `ImageCropPreview`, `DocumentPages`
