# Linky

Linky is a mobile-first PWA for contacts, private Nostr messaging and Lightning/Cashu payments. Data lives in Evolu (SQLite) on the device and syncs between devices through an Evolu relay. The app runs at `app.linky.fit` and as an Android app. `apps/site/` is the public website `linky.fit`, with the `/cashu/` token redemption page.

## Development

Requirements: Bun and Docker (local Nostr relay, Evolu relay and FakeWallet Cashu mint). Android builds need Java 17.

```bash
bun install
bun run dev          # Docker stack, web app on :5173, push service on :8787
bun run test         # unit tests in every workspace
bun run check-code   # typecheck, eslint --fix, prettier --write
```

End-to-end tests (Playwright against a Docker stack owned by the checkout, so worktrees can run them side by side):

```bash
bun run e2e          # web-app suite; extra args go to Playwright
bun run e2e site     # site suite
bun run e2e down     # stop the stack and drop its data
```

## Workspaces

Apps: `apps/web-app` (the product), `apps/site`, `apps/push` (Web Push and FCM service), `apps/native-shell` (Capacitor Android and iOS shells), `apps/linkshu-cli` (terminal cashu wallet), `tools/nostr-error-tracker`.

Packages:

- [`packages/linkstr`](./packages/linkstr/README.md): Nostr protocol library; guides in [`docs/`](./packages/linkstr/docs/), which also cover `@linky-fit/linkstr-react`
- [`packages/linkshu`](./packages/linkshu/README.md): cashu wallet library; guides in [`docs/`](./packages/linkshu/docs/)
- [`packages/linksync`](./packages/linksync/README.md): synced storage (Evolu schema, repositories, shards); guides in [`docs/`](./packages/linksync/docs/)
- [`packages/proxy-payment`](./packages/proxy-payment/README.md): proxy bank payments (bank QR parsing, offer rules); guides in [`docs/`](./packages/proxy-payment/docs/)
- [`packages/recurring-payment`](./packages/recurring-payment/README.md): recurring payments (schedule math, the planner, claims between devices); guides in [`docs/`](./packages/recurring-payment/docs/)
- [`packages/keryx`](./packages/keryx/README.md): Keryx client (join URLs, pairing, TUF and item verification for company announcements); guide in [`docs/keryx.md`](./packages/keryx/docs/keryx.md)
- [`packages/ui`](./packages/ui/README.md): Tamagui design system for Expo and the web (react-native-web)
- `packages/domain`: the branded ids every package and the app share
- `packages/identity`: key derivation (SLIP-39, Nostr, LNURL auth) shared by the app and the error tracker
- `packages/config`: shared eslint, prettier, tsconfig and npm packaging

`@linky-fit/linkshu` and `@linky-fit/linkstr` publish to npm together; see [`docs/npm-releases.md`](./docs/npm-releases.md).


Further reading:

- [`AGENTS.md`](./AGENTS.md): invariants and conventions
- [`apps/native-shell/README.md`](./apps/native-shell/README.md): Android and iOS builds, signing, push setup
- [`apps/push/README.md`](./apps/push/README.md): push service configuration and deployment
- [`apps/linkshu-cli/README.md`](./apps/linkshu-cli/README.md): terminal wallet
- [`tools/nostr-error-tracker/README.md`](./tools/nostr-error-tracker/README.md): error dashboard
- [`docker/evolu-relay/README.md`](./docker/evolu-relay/README.md): relay image and per-owner quota

## Contributing

Open an issue before a PR for anything beyond a plain bug fix. See [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## License

Zero-Clause BSD (`0BSD`), see [`LICENSE`](./LICENSE).
