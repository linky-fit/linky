# @linky/ui-book-next

Web catalog for `@linky/ui`. It previews every component, the wallet and conversation compositions, dark and light themes, and a 320px narrow example width. Search by component name or group. Source snippets sit below each group.

From the repository root:

```sh
bun run --filter @linky/ui-book-next dev
bun run --filter @linky/ui-book-next build
bun run --filter @linky/ui-book-next test:e2e
```

Dev runs at http://127.0.0.1:5190. Production preview runs at http://127.0.0.1:5192. No service stack is needed. Examples use local state and reset on reload; no messages or payments leave the browser.

The catalog imports shared UI only from `@linky/ui`. `src/styles.css` controls the catalog shell, example framing, font loading, and viewport layout. Vite selects React Native web implementations and transforms JSX in the QR dependency.

The four portraits in `public/avatars/` were copied unchanged from the approved `linky-design/public/avatars/` demo. They are illustrative fixtures, not user identity data. Manrope files are self-hosted copies from `@expo-google-fonts/manrope` 0.4.2 under the bundled `public/fonts/OFL.txt` license.

`tests/catalog.spec.ts` checks user interactions against the production build. Native device behavior belongs to the component package's device validation, outside this web catalog.
