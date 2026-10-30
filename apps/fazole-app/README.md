# fazole.fit app

A payment terminal PWA for Czech merchants: bank transfers (SPD QR), Lightning and Cashu. It runs on Linky's packages: the account is a Linky recovery seed, data lives in Linky's sharded Evolu database (`@linky-fit/linksync`), Nostr goes through `@linky-fit/linkstr` and the wallet through `@linky-fit/linkshu`. Czech and English, dark only.

## Develop

From the repo root:

```bash
bun install
docker compose -f docker-compose.dev.yml up -d --wait   # Nostr relay :7777, Evolu relay :4001, mint :3338
bun run fazole:dev                                      # http://localhost:5280
```

`.env.development` points the app at those services. `bun run fazole:dev:prod` skips that file and runs the dev server against the production relays and mint (`https://cashu.cz`), which is the only way a message or a token reaches a real Linky user: the local relay and mint never leave your machine. The local mint's FakeWallet settles every invoice it issues, so a Bitcoin payment turns paid by itself a moment after its QR appears. Linky's web app (`bun run --filter @linky-fit/linky-app dev`) on the same services is the customer wallet and a withdrawal target.

`bun run --filter @linky-fit/fazole-app test` runs the unit tests; `src/services/localMint.test.ts` also runs against the local mint when it answers and is skipped otherwise.

A shop with a MONETA account can have the bank confirm its bank QR payments: the merchant pastes an API token from Internet Banka (Nastavení › Správa API tokenů, view-only rights) in Settings, and `src/services/bankPayments.ts` polls the account's transaction history for the payment's variable symbol while its QR code is on screen. The bank answers no browser directly (no CORS), so the app calls `/api/moneta/*` on its own origin: the dev server proxies it to `api.moneta.cz` (`vite.config.ts`), and on Vercel `api/moneta.ts` relays it (`vercel.json`), GET only, with the token passed through in the header and never logged. The token is stored as a synced setting, so every device of the shop has it.

## Layout

- `src/domain`: pure rules: Czech accounts and IBAN, SPD, variable symbols, money and keypad, payment status, Bitcoin request matching, withdrawal targets, history and wallet activity.
- `src/storage`: the account (recovery seed and what derives from it), the Evolu store, the shop profile, payments, receipts, direct transfers and withdrawals as Linky `setting` and `transaction` rows, and the support chat as a Linky conversation.
- `src/services`: one linkstr and one linkshu runtime per launch behind `AppServices`; `Device` creates, restores and resets the account; `bankPayments.ts` confirms bank QR payments through MONETA's API (`monetaApi.ts`); `pledges.ts` forwards every inflow to the Linky user whose cash the shop holds as a pledge until it is repaid, naming them by NIP-05 (`contacts.ts`); `supportChat.ts` is the NIP-17 chat with Fazole support's hardcoded npub; `react.ts` holds the hooks screens use.
- `src/platform`: browser APIs (localStorage, password manager, device wipe, service worker, clipboard, hash routes, the QR camera scanner, the image picker).
- `src/routing.ts`: the hash routes and where each lands for the account's state; `src/shell` renders them, the terminal alone and the other sections with bottom tabs (a rail on wide screens).
- `src/screens`: the screens, composed from `@linky-fit/ui` only; their form rules (`shopForm.ts`, `withdrawForm.ts`) are plain modules with unit tests. Strings live in `src/copy/`, one file per language; the app starts in the merchant's choice from Settings, otherwise in Czech on a Czech device and English on any other, and switching reloads it.

The PWA icons are generated from `public/logo.webp` (`pwa-assets.config.ts`); the in-app logo is `public/logo-tile.webp`.
