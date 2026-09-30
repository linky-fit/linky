# Linky

Linky is a mobile-first PWA for contacts, private Nostr messaging and Lightning/Cashu payments. It is local-first: data lives in Evolu (SQLite) on the device and syncs between devices through an Evolu relay. The app runs at `app.linky.fit` and as an Android app; `apps/site/` is the public website for `linky.fit`, including the `/cashu/` token redemption page.

## Workspaces

Apps: `apps/web-app` (the product), `apps/site`, `apps/push` (Web Push and FCM service), `apps/native-shell` (Capacitor Android and iOS shells), `apps/linkshu-cli` (terminal cashu wallet), `tools/nostr-error-tracker`.

Packages:

- [`packages/linkstr`](./packages/linkstr/README.md): Nostr protocol library; guides in [`docs/`](./packages/linkstr/docs/), which also cover `@linky-fit/linkstr-react`
- [`packages/linkshu`](./packages/linkshu/README.md): cashu wallet library; guides in [`docs/`](./packages/linkshu/docs/)
- [`packages/linksync`](./packages/linksync/README.md): synced storage (Evolu schema, repositories, shards); guides in [`docs/`](./packages/linksync/docs/)
- [`packages/proxy-payment`](./packages/proxy-payment/README.md): proxy bank payments (bank QR parsing, offer rules and reducer); guides in [`docs/`](./packages/proxy-payment/docs/)
- `packages/identity`: key derivation (SLIP-39, Nostr, LNURL auth) shared by the app and the error tracker
- `packages/config`: shared eslint, prettier, tsconfig and npm packaging

`@linky-fit/linkshu` and `@linky-fit/linkstr` publish to npm together; see [`docs/npm-releases.md`](./docs/npm-releases.md).

## Development

Requirements: Bun, Docker (for the local Nostr relay, Evolu relay and FakeWallet Cashu mint). Android builds need Java 17.

```bash
bun install
bun run dev          # Docker stack, web app on :5173, push service on :8787
bun run test         # unit tests in every workspace
bun run check-code   # typecheck, eslint --fix, prettier --write
```

End-to-end tests (Playwright, several accounts on one machine against the Docker stack):

```bash
docker compose -f docker-compose.dev.yml --profile e2e up -d --build --wait
cd apps/web-app && bunx playwright test --project=local-stack
```

Further reading:

- [`AGENTS.md`](./AGENTS.md): conventions, test recipes and gotchas
- [`docs/architecture.md`](./docs/architecture.md): architectural constraints
- [`apps/native-shell/README.md`](./apps/native-shell/README.md): Android and iOS builds, signing, push setup
- [`apps/push/README.md`](./apps/push/README.md): push service configuration and deployment
- [`apps/linkshu-cli/README.md`](./apps/linkshu-cli/README.md): terminal wallet
- [`tools/nostr-error-tracker/README.md`](./tools/nostr-error-tracker/README.md): error dashboard
- [`docker/evolu-relay/README.md`](./docker/evolu-relay/README.md): relay image and per-owner quota

## License

Zero-Clause BSD (`0BSD`), see [`LICENSE`](./LICENSE).
