# @linky/ui-book

React Native catalog for `@linky/ui`, using Expo SDK 57 and Metro. The same app runs on iOS, Android, and web. It previews every component, wallet and conversation compositions, dark and light themes, and a 320px narrow example width. Search by component name or group. Source snippets sit below each group.

From the repository root:

```sh
bun run ui:dev       # Expo dev server and QR code for Expo Go
bun run ui:ios       # Open in the iOS simulator (requires Xcode)
bun run ui:android   # Open on an Android emulator or connected device
bun run ui:web      # Browser preview at http://localhost:5190
bun run ui:build    # Export bundles and assets for all three platforms
bun run --filter @linky/ui-book test:e2e
```

Use Node 22.13 or newer with Bun installed. Expo Go must support SDK 57. For a physical device, run `ui:dev` and scan its QR code from the same network. Android requires an emulator or a device connected through ADB. No Linky account or service stack is needed. Examples use local state and reset on reload; no messages or payments leave the app.

`ui:build` writes Metro exports to `dist/`, including native Hermes bundles. It does not produce an APK or IPA. Expo Go provides the native runtime for development. For a standalone native development build, run `bunx expo run:ios` or `bunx expo run:android` from this directory. Generated `ios/` and `android/` projects are ignored.

The catalog imports shared UI only from `@linky/ui`. The shell uses React Native views and scrolling, Tamagui layouts, safe-area insets, and iOS keyboard avoidance. Android uses the default resize behavior. A sidebar becomes horizontally scrollable component groups on narrow screens. Metro resolves platform-specific library files, including the native inputs and browser dialog behavior.

The four portraits in `assets/avatars/` were copied unchanged from the approved `linky-design/public/avatars/` demo. They are fictional fixtures. Metro bundles them as assets, and `expo-asset` resolves their URIs on each platform. Manrope files are bundled copies from `@expo-google-fonts/manrope` 0.4.2 under `assets/fonts/OFL.txt`; `expo-font` registers the regular, semibold, and bold faces before the catalog renders.

`tests/catalog.spec.ts` exercises the production web export with Playwright. It covers catalog search, themes, narrow layouts, messages, attachments, dialogs, selection, and payment examples. Run `bun run --filter @linky/ui-book build:web` and `bun run --filter @linky/ui-book preview` to inspect that export at `http://127.0.0.1:5192`.

For native checks, open the catalog in Expo Go and exercise search, theme switching, each component group, dialog dismissal, and message entry with the keyboard visible. Check a phone and tablet layout. Browser tests do not establish native keyboard or accessibility behavior.

`bunx expo install --check` checks SDK compatibility. With Bun isolated installs, Expo Doctor currently reports separate paths for identical versions of `expo-asset`, `expo-font`, and `expo-constants`. `bunx expo-modules-autolinking resolve --platform apple --json` selects one native module for each; Expo's monorepo module resolution uses that selection in Metro too. Doctor also flags the repository's conventional `eslint` and `prettier` script names.
