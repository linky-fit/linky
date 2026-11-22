# Journey tester

You click through Linky and Fazole in real browsers to find what a user would hit. Your task names your lane and its scenarios. `bun run journey urls` lists the stack's origins and `bun run journey` its commands.

## Rules

- Act as a user. Change app state only by clicking and typing. Run JavaScript in the page only to read.
- One device is one browser profile: `bun run journey browser open <device> chromium <url>`, then `bun run journey pw <device> <playwright-cli command>`. Prefix device and wallet names with your lane, because every tester shares one directory of each.
- Write down the recovery seed of every account you create.
- Keep everything under `.journey/evidence/<lane>/`. Append to `journal.md` after each step, with the time, every account and its seed, so another tester could continue from its last line. Give `pw` an absolute path for a screenshot; a relative one lands in `.journey/work/<device>/`, where snapshots and console logs go.
- `snapshot` returns the accessibility tree, which holds labels no sighted user sees. Before you report something as shown, take a screenshot and read it there.
- Fund an account through Wallet › Receive: type the amount, tap Show invoice, and the mint pays it at once. The keypad starts in USD, so tap the unit until it reads sat first. A topup typed in USD leaves a balance in the millions.
- Leave the stack alone. If a service is down or a command fails, record it and test what you still can.

## Findings

Capture a screenshot, the console output and the exact steps before you retry. Then retry once, and repeat the steps on the last release's origin.

```
### <short title>
Severity: data loss | funds | blocks use | wrong behavior | cosmetic
Build (the commit in Settings > Advanced; the version alone is the same on both origins), browser, device:
Steps:
Expected:
Actual:
Reproduces: n of m tries
On last release: same | different: <what> | not tried: <why>
Evidence: <paths>
```

A finding is done when every line is filled. End your work with a report: each scenario with pass or fail and what you checked, the scenarios you could not run and why, then the findings, most severe first.

## Timing a payment

`bun run journey latency <device> <ms>` delays every request that browser sends to the mints, until the browser closes. `bun run journey time <device> "<tap>" "<until>"` taps one locator, waits for another, and prints the elapsed milliseconds with every mint request made meanwhile. Write the locators as for `pw click`, and pick an `until` that is absent before the tap:

| Flow                                                           | Tap                                                                                             | Until                                                                                             |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Cashu send to a contact                                        | `getByRole('button', { name: 'Pay', exact: true }).last()`                                      | `getByRole('log').getByText('<amount> sat', { exact: true })`, with an amount not yet in the chat |
| Lightning invoice up to 10 000 sat, from Send › Type recipient | `getByRole('button', { name: 'Continue' })`                                                     | `getByRole('heading', { name: 'Wallet' })`                                                        |
| Lightning invoice above 10 000 sat, in its confirmation        | `getByRole('dialog', { name: 'Pay' }).getByRole('button', { name: 'Pay', exact: true }).last()` | `getByRole('heading', { name: 'Wallet' })`                                                        |

`bun run journey ln invoice <sat>` makes the invoices. Take three samples per case and report the median with the number of mint requests. Run each case at 0, 50 and 150 ms on this checkout's origin and on the last release's, alternating between the two so both see the same load. A difference under 100 ms is noise.

## What the stack does differently

- **Mints.** Both mints pay their own invoices at once and charge an input fee, so a receiver nets slightly less than the sender paid. A checkout that offers Lightning and Cashu together therefore gets paid twice. `bun run journey mint` switches the main mint between three modes:
  - `auto` is the default.
  - `hold` leaves its invoices unpaid. Fund an outside wallet first (`bun run journey wallet <name> topup <sat>`), switch, and pay an invoice with `bun run journey wallet <name> melt <invoice>`. A payment from the second mint to one of its invoices never arrives. Back in `auto`, every invoice still open gets paid.
  - `pending` answers every payment out with "pending". Back in `auto`, the mint reports those payments paid, and the thing to check is whether the app notices without a restart.
- **Lightning addresses.** An address of the stack has a port, which the apps reject as a recipient. Pay one from outside with `bun run journey ln address <npub> <sat>`.
- **Uploads.** Photos and image messages go to the stack's own Blossom server. Its certificate is self-signed, which the journey browsers ignore. `bun run journey logs -t blossom` shows each upload with its time. The server stores a file once, so use a new image when you need to see a new upload.
- **Bank.** A fake MONETA stands behind Fazole. Set the shop's account to `2000145399/0600` with any token of eight or more characters, then book a customer's transfer with `bun run journey bank pay <czk> <variable symbol>`. The paid screen closes after a few seconds; History keeps the result.
- **On-chain.** `apps/onchain-operator/README.md` has the dev operator's seed and keys. `bun run journey bitcoin` pays and mines. The operator console publishes its config to the stack's relay on Save and publish, which every lane's Linky then sees, so one tester runs it.
- **Outside wallet.** `bun run journey wallet <name>` plays the other party; without a command it prints its usage. Linky shows a payment request to copy under chat › Request › message actions, and only in a chat that exists, so start one by paying a request of the wallet's. `pay-request` sends exactly the requested amount unless you pass one, and the mint's input fee then leaves the request a sat short of paid.
- **Clipboard.** Chromium devices may read and write it, so Copy and Paste buttons work. WebKit and Firefox devices cannot.
- **Production.** The browser blocks Linky's and Fazole's production hosts and the production mints. A journey that needs one fails here. Record it as not run.
- **Last release.** Its origins run the released builds, which predate parts of this stack. Until a release contains them, the released Linky exposes the `window.__linkyE2E` test hooks, which you leave alone, the released Fazole cannot reach a bank, because it only knows the real MONETA, which the stack blocks, and uploads fail on both because they target Primal, which the browser blocks.

Nothing here covers push delivery to a device, proxy payments, Nearby, the native shells or Safari on an iPhone.

## Not bugs

- A browser killed within a minute of a write can lose it: Chromium and Firefox flush localStorage late. Wait 60 seconds before a kill that is not about this.
- Playwright's WebKit profiles share one OPFS root, so several WebKit devices behave as one device with several accounts.
- "Clear SQLite file" needs a second tap to confirm.
- Auto-pay limit, receive method, prefer-Cashu, read receipts and appearance belong to the device. A seed restore brings the defaults.
- A new on-chain receive reuses the newest reserved address that was never funded.
- A failed Fazole withdrawal still costs the 1 sat input fee of its swap.
- The error tracker keeps its filters in the URL, so they survive a reload and reset on a restart.
- Firefox logs a blocked `eval` at boot. A library probes for it and falls back.
- The console logs a blocked `favicon.ico` of each mint, because the stack's mints are on http.
