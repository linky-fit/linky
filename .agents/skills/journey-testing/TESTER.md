# Journey tester

You click through Linky and Fazole in real browsers to find what a user would hit. Your task names your lane and its scenarios. `bun run journey urls` lists the stack's origins and `bun run journey` its commands.

## Rules

- Act as a user. Change app state only by clicking and typing. Run JavaScript in the page only to read.
- One device is one browser profile: `bun run journey browser open <device> chromium <url>`, then `bun run journey pw <device> <playwright-cli command>`. Prefix device names with your lane, because every tester shares one profile directory.
- Write down the recovery seed of every account you create.
- Keep everything under `.journey/evidence/<lane>/`. Append to `journal.md` after each step, with the time, every account and its seed, so another tester could continue from its last line.
- `snapshot` returns the accessibility tree, which holds labels no sighted user sees. Before you report something as shown, take a screenshot and read it there.
- Check the unit on an amount keypad before you type. A topup typed in USD leaves a balance in the millions.
- Leave the stack alone. If a service is down or a command fails, record it and test what you still can.

## Findings

Capture a screenshot, the console output and the exact steps before you retry. Then retry once, and repeat the steps on the last release's origin.

```
### <short title>
Severity: data loss | funds | blocks use | wrong behavior | cosmetic
Build, browser, device:
Steps:
Expected:
Actual:
Reproduces: n of m tries
On last release: same | different: <what> | not tried: <why>
Evidence: <paths>
```

A finding is done when every line is filled. End your work with a report: each scenario with pass or fail and what you checked, the scenarios you could not run and why, then the findings, most severe first.

## What the stack does differently

- **Mints.** Both mints pay their own invoices after about 3 seconds and charge an input fee, so a receiver nets slightly less than the sender paid. A checkout that offers Lightning and Cashu together therefore gets paid twice. For an invoice that must stay unpaid, fund an outside wallet first (`bun run journey wallet <name> topup <sat>`), run `bun run journey mint hold`, and pay with `bun run journey wallet <name> melt <invoice>`. While the main mint holds, a payment from the second mint to one of its invoices never arrives. `bun run journey mint auto` pays every invoice still open.
- **Lightning addresses.** An address of the stack has a port, which the apps reject as a recipient. Pay one from outside with `bun run journey ln address <npub> <sat>`.
- **Uploads.** Photos and image messages go to `blossom.primal.net`, a public server. Upload only throwaway images.
- **Bank.** A fake MONETA stands behind Fazole. Set the shop's account to `2000145399/0600` with any token of eight or more characters, then book a customer's transfer with `bun run journey bank pay <czk> <variable symbol>`.
- **On-chain.** `apps/onchain-operator/README.md` has the dev operator's seed and keys. `bun run journey bitcoin` pays and mines.
- **Production.** The browser blocks Linky's and Fazole's production hosts and the production mints. A journey that needs one fails here. Record it as not run.
- **Last release.** Its origins run the released builds, which predate parts of this stack. Until a release contains them, the released Linky exposes the `window.__linkyE2E` test hooks, which you leave alone, and the released Fazole asks the real MONETA.

Nothing here covers push delivery to a device, Keryx newsletters, proxy payments, Nearby, the native shells or Safari on an iPhone.

## Not bugs

- A browser killed within a minute of a write can lose it: Chromium and Firefox flush localStorage late. Wait 60 seconds before a kill that is not about this.
- Playwright's WebKit profiles share one OPFS root, so several WebKit devices behave as one device with several accounts.
- "Clear SQLite file" needs a second tap to confirm.
- Auto-pay limit, receive method, prefer-Cashu, read receipts and appearance belong to the device. A seed restore brings the defaults.
- A new on-chain receive reuses the newest reserved address that was never funded.
- A failed Fazole withdrawal still costs the 1 sat input fee of its swap.
- The error tracker keeps its filters in the URL, so they survive a reload and reset on a restart.
- Firefox logs a blocked `eval` at boot. A library probes for it and falls back.
