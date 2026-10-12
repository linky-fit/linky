# Linky

[![Linky release](https://img.shields.io/github/v/release/linky-fit/linky?label=release&display_name=release&filter=Linky*)](https://github.com/linky-fit/linky/releases/latest)
[![app.linky.fit](https://img.shields.io/github/deployments/linky-fit/linky/Production?label=app.linky.fit)](https://github.com/linky-fit/linky/deployments/Production)
[![linky.fit](https://img.shields.io/github/deployments/linky-fit/linky/Production%20%E2%80%93%20linky-website?label=linky.fit)](https://github.com/linky-fit/linky/deployments/Production%20%E2%80%93%20linky-website)
[![push.linky.fit](https://img.shields.io/github/deployments/linky-fit/linky/push?label=push.linky.fit)](https://github.com/linky-fit/linky/deployments/push)
[![Fazole release](https://img.shields.io/github/v/release/linky-fit/linky?label=release&display_name=release&filter=Fazole*)](https://github.com/linky-fit/linky/releases?q=fazole-v)
[![app.fazole.fit](https://img.shields.io/github/deployments/linky-fit/linky/Fazole%20production?label=app.fazole.fit)](https://github.com/linky-fit/linky/deployments/Fazole%20production)
[![fazole.fit](https://img.shields.io/github/deployments/linky-fit/linky/Production%20%E2%80%93%20fazole-site?label=fazole.fit)](https://github.com/linky-fit/linky/deployments/Production%20%E2%80%93%20fazole-site)
[![@linky-fit/linkshu](https://img.shields.io/npm/v/@linky-fit/linkshu?label=%40linky-fit%2Flinkshu)](https://www.npmjs.com/package/@linky-fit/linkshu)
[![@linky-fit/linkstr](https://img.shields.io/npm/v/@linky-fit/linkstr?label=%40linky-fit%2Flinkstr)](https://www.npmjs.com/package/@linky-fit/linkstr)
[![@linky-fit/linkauth](https://img.shields.io/npm/v/@linky-fit/linkauth?label=%40linky-fit%2Flinkauth)](https://www.npmjs.com/package/@linky-fit/linkauth)
[![npm release](https://img.shields.io/github/deployments/linky-fit/linky/npm?label=npm%20release)](https://github.com/linky-fit/linky/deployments/npm)

Linky is a mobile-first PWA for contacts, private Nostr messaging and Lightning/Cashu payments. Data lives in Evolu (SQLite) on the device and syncs between devices through an Evolu relay. The app runs at `app.linky.fit` and as an Android app; `nightly.app.linky.fit` runs `main` ahead of the last release (see [`docs/releases.md`](./docs/releases.md)). `apps/linky-site/` is the public website `linky.fit`, with the `/cashu/` token redemption page.

Fazole (`app.fazole.fit`) is a payment terminal PWA for Czech merchants: bank transfers (SPD QR), Lightning and Cashu. It runs on Linky's packages and shares Linky accounts, but ships on its own version and release (see [`docs/releases.md`](./docs/releases.md)). `apps/fazole-site/` is its website `fazole.fit`.

## Development

Requirements: Bun and Docker (local Nostr relay, Evolu relay and FakeWallet Cashu mint). Android builds need Java 17.

```bash
bun install
bun run dev           # Docker stack, Linky app on :5173, push service on :8787
bun run fazole:dev    # Fazole app on :5280; needs the Docker stack `bun run dev` starts
bun run test          # unit tests in every workspace
bun run check-code    # typecheck, eslint --fix, prettier --write
bun run test-changed  # unit tests in the workspaces this branch reaches
bun run check-changed # check-code in the workspaces this branch reaches
```

End-to-end tests (Playwright against a Docker stack owned by the checkout, so worktrees can run them side by side):

```bash
bun run e2e          # linky-app suite; extra args go to Playwright
bun run e2e expo     # linky-app suite against the apps/expo build
bun run e2e site     # linky-site suite
bun run e2e down     # stop the stack and drop its data
```

## Workspaces

Apps: `apps/linky-app` (Linky), `apps/linky-site`, `apps/fazole-app` (Fazole), `apps/fazole-site`, `apps/push` (Web Push and FCM service), `apps/native-shell` (Capacitor Android and iOS shells), `apps/desktop` (Electron shell for macOS), `apps/linkshu-cli` (terminal cashu wallet), `apps/ui-book` (catalog of `@linky-fit/ui`), `tools/nostr-error-tracker`.

Packages:

- [`packages/linkstr`](./packages/linkstr/README.md): Nostr protocol library; guides in [`docs/`](./packages/linkstr/docs/), which also cover `@linky-fit/linkstr-react`
- [`packages/linkauth`](./packages/linkauth/README.md): Nostr authentication SDK (client, server and signer); guides in [`docs/`](./packages/linkauth/docs/)
- [`packages/linkshu`](./packages/linkshu/README.md): cashu wallet library; guides in [`docs/`](./packages/linkshu/docs/)
- [`packages/linksync`](./packages/linksync/README.md): synced storage (Evolu schema, repositories, shards); guides in [`docs/`](./packages/linksync/docs/)
- [`packages/proxy-payment`](./packages/proxy-payment/README.md): proxy bank payments (bank QR parsing, offer rules); guides in [`docs/`](./packages/proxy-payment/docs/)
- [`packages/recurring-payment`](./packages/recurring-payment/README.md): recurring payments (schedule math, the planner, claims between devices); guides in [`docs/`](./packages/recurring-payment/docs/)
- [`packages/keryx`](./packages/keryx/README.md): Keryx client (join URLs, pairing, TUF and item verification for company announcements); guide in [`docs/keryx.md`](./packages/keryx/docs/keryx.md)
- [`packages/ui`](./packages/ui/README.md): Tamagui design system for Expo and the web (react-native-web)
- `packages/domain`: the branded ids every package and the app share
- `packages/identity`: key derivation (SLIP-39, Nostr, LNURL auth) shared by the app and the error tracker
- `packages/config`: shared eslint, prettier, tsconfig and npm packaging

`@linky-fit/linkshu`, `@linky-fit/linkstr` and `@linky-fit/linkauth` publish to npm together; see [`docs/npm-releases.md`](./docs/npm-releases.md).

Further reading:

- [`AGENTS.md`](./AGENTS.md): invariants and conventions
- [`docs/releases.md`](./docs/releases.md): how each Linky and Fazole target ships
- [`apps/fazole-app/README.md`](./apps/fazole-app/README.md): Fazole development and its local mint
- [`apps/native-shell/README.md`](./apps/native-shell/README.md): Android and iOS builds, signing, push setup
- [`apps/desktop/README.md`](./apps/desktop/README.md): macOS desktop shell
- [`apps/push/README.md`](./apps/push/README.md): push service configuration and deployment
- [`apps/linkshu-cli/README.md`](./apps/linkshu-cli/README.md): terminal wallet
- [`tools/nostr-error-tracker/README.md`](./tools/nostr-error-tracker/README.md): error dashboard
- [`docker/evolu-relay/README.md`](./docker/evolu-relay/README.md): relay image and per-owner quota

## Contributing

Open an issue before a PR for anything beyond a plain bug fix. See [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## License

Zero-Clause BSD (`0BSD`), see [`LICENSE`](./LICENSE).
