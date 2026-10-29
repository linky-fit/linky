# On-chain operator

The console the on-chain operator fulfils on-chain transfers from (see `GLOSSARY.md`, "On-chain transfers"): a small React app on Linky's packages, English only, deployed by hand to https://operator.twoballers.dev. It signs in with the recovery seed of a Linky account dedicated to transfers; Linky knows that account by its npub (`VITE_ONCHAIN_OPERATOR_NPUB`). The protocol is in [`packages/onchain-transfer/docs`](../../packages/onchain-transfer/docs/README.md).

- **Transfers**: open transfers oldest first, then the history. A transfer's page shows what to do next: pay the payout address and paste the txid (on-chain send), send the user's ecash (on-chain receive), refund or cancel. Requests are accepted on arrival; an on-chain receive the console could not give an address to (no wallet key saved, Esplora not answering) waits in Transfers to accept or deny by hand.
  - An **on-chain send** is accepted the moment its request arrives, because Linky sends the user's Cashu right after requesting, so it may even arrive before the request. Cashu naming a send the console has not accepted yet is kept aside on the device that received it (`localStorage`, `onchain-operator.earlyEcash`) and reported as "Funds received" once the send is accepted. A send the console would have denied (paused, an amount not offered, another fee, an address of another network) is accepted all the same and shows the reason as a warning: refund the Cashu instead of paying out. Cashu short of the amount plus the fee shows as a notice to settle in the chat.
  - An **on-chain receive** is accepted on arrival as well, with a fresh deposit address, so Linky shows the deposit QR right after the user confirms; one the console could not give an address to waits in Transfers. A receive the console cannot take (paused, an amount not offered, another fee, an address of another network, an unpayable payment request) is denied with the reason. An **on-chain receive of any amount** (a request naming no amount, which new Linky versions send) is stored at the smallest receive until its deposit arrives; the deposit then sets the terms: the user gets the most the deposit pays for, up to the largest receive, and the rest is the fee. A deposit short of the smallest receive with its fee stays "Deposit seen" to refund; one past the largest pays the largest, the surplus is settled in the chat.
- **Chats**: one NIP-17 chat per user, with their transfers inline.
- **Wallet**: the ecash balance at each mint. It must hold ecash at the transfer mint to pay on-chain receives. "Send Cashu" issues a token of a chosen amount, shown as a QR code to copy or scan; whoever holds it can spend it, and until someone claims it, it is listed under "Sent tokens" with "Take back", which returns it to the balance and voids the copy handed out. "Pay over Lightning" pays a BOLT11 invoice, or a Lightning address with an amount, by a melt: it shows the amount and the most the fees can take, then pays on confirmation. A payment the mint has not settled stays reserved and is settled on the next start.
- **Stats**: for all time, this month or the last 30 days, what users got and sent through completed transfers and the service fees earned, the same per direction, and how many transfers completed, are open, were refunded, cancelled or denied; all time adds a table per month. Transfers count by their request time in the browser's time zone, since completion time is not stored; miner fees the operator paid are not tracked.
- **Settings**: the profile (name, the xpub or Taproot descriptor of a BIP86 wallet account as Trezor Suite or Sparrow shows it, service fee in %, the fixed amounts of an on-chain send, the largest and the smallest on-chain receive, description, pause switch, minimum Linky version, watchers). An on-chain send is made for one of the fixed amounts and an on-chain receive for any amount up to the largest; the amount is what the user gets, and they send it plus the service fee. A receive of any amount takes a deposit between the smallest and the largest receive, the fee on top; publishing the smallest receive is what offers it to Linky. Saving publishes the on-chain config and the name as the account's Nostr profile, and shows deposit address #0 to compare with the wallet. Once the profile is saved, the profile picture row picks an image, crops it square to 512 px, uploads it to `blossom.primal.net` signed with the account key and publishes it as the Nostr profile picture right away, without saving the form; removing it unpublishes it the same way.
- **Watchers**: npubs that get a Linky chat message from the operator account whenever something waits for the operator: an on-chain receive request the console could not accept by itself, ecash to pay out, a confirmed deposit, a cancel after funds moved, or any message someone other than a watcher sends the operator. Every message starts with the user's whole npub. Messages never quote ecash. Every open device of the operator sends them.

The app checks the deposit address of every open on-chain receive against Esplora every 20 seconds and when the window gets the focus; on-chain receive requests it cannot take (paused, an amount not offered or none under no smallest receive, another fee, address of another network, unpayable payment request) are denied automatically, while on-chain sends are always accepted.

## Run it locally

```bash
docker compose -f docker-compose.dev.yml up -d --wait   # relay, Evolu relay, FakeWallet mint (or `bun run dev`)
bun run bitcoin:up && bun run bitcoin -- init           # regtest bitcoind, Esplora API :3002, explorer :3003
bun run onchain-operator:dev                            # http://localhost:5295
```

`.env.development` points the app at those services and at regtest. `bun run onchain-operator:dev:prod` uses the production defaults instead: Linky's recommended relays, `https://cashu.cz`, mainnet and mempool.space.

## Deploy

The console is a static build in the Vercel project `linky-swap-operator`, deployed by hand; a production build uses mainnet, `https://cashu.cz`, mempool.space and Linky's recommended relays.

```bash
bun run onchain-operator:build
rm -rf /tmp/onchain-operator-deploy && mkdir /tmp/onchain-operator-deploy
cp -R apps/onchain-operator/dist/. apps/onchain-operator/vercel.json /tmp/onchain-operator-deploy/
cd /tmp/onchain-operator-deploy && vercel link --yes --project linky-swap-operator && vercel deploy --prod --yes
```

## Dev fixture

**Dev only.** These keys are committed on purpose for local regtest; never fund them on mainnet or any public network, and never use them as a real operator.

- Recovery seed of the dev operator (paste it on the sign-in screen):

  ```text
  hand pregnant academic academic curious twin literary criminal teaspoon academic lying empty pipeline infant axle failure repair exotic frequent march
  ```

- Its npub, which the dev Linky uses as `VITE_ONCHAIN_OPERATOR_NPUB`: `npub1j3ntgmxzkw4rrxeh5ksrkca4tq994exjxxz2xr8dwp6xzgtjqq3s490wfg`
- BIP86 test-network account `m/86'/1'/0'` of the BIP39 test mnemonic `abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about`:
  - tpub, to paste in Settings: `tpubDDfvzhdVV4unsoKt5aE6dcsNsfeWbTgmLZPi8LQDYU2xixrYemMfWJ3BaVneH3u7DBQePdTwhpybaKRU95pi6PMUtLPBJLVQRpzEnjfjZzX`
  - tprv: `tprv8gytrHbFLhE7zLJ6BvZWEDDGJe8aS8VrmFnvqpMv8CEZtUbn2NY5KoRKQNpkcL1yniyCBRi7dAPy4kUxHkcSvd9jzLmLMEG96TPwant2jbX`
  - deposit address #0 on regtest: `bcrt1p8wpt9v4frpf3tkn0srd97pksgsxc5hs52lafxwru9kgeephvs7rqjeprhg`

## A transfer on regtest

1. Sign in with the dev seed, open Settings, paste the tpub and save. The on-chain config is published to the local relay.
2. Import the tprv into bitcoind, so the `operator` wallet owns the deposits and can pay payouts and refunds:

   ```bash
   bun run bitcoin -- import-descriptor operator 'tr(tprv8gytrHbFLhE7zLJ6BvZWEDDGJe8aS8VrmFnvqpMv8CEZtUbn2NY5KoRKQNpkcL1yniyCBRi7dAPy4kUxHkcSvd9jzLmLMEG96TPwant2jbX/0/*)'
   bun run bitcoin -- cli -rpcwallet=operator getbalance
   ```

3. Request a transfer from the dev Linky with experimental features on (Settings > Experimental features): Send > Send to on-chain wallet, or Receive > Receive from on-chain wallet. Both are accepted on arrival: Linky pays an on-chain send right away and shows the deposit address of an on-chain receive at once. A receive only waits in Transfers when the console could not give it an address (no tpub saved, Esplora down).
4. On-chain send: once the user's ecash arrived (right after the request, or even before it) the transfer shows "Funds received". Pay the payout address, e.g. from the funded `dev` wallet with `bun run bitcoin -- send <payout address> <btc>` or from the `operator` wallet with `bun run bitcoin -- cli -rpcwallet=operator sendtoaddress <payout address> <btc>`, paste the txid and confirm. The app checks that the transaction pays the address what the user gets. A send flagged with a warning is one to refund with "Refund Cashu" instead.
5. On-chain receive: pay the deposit address any amount between the smallest and the largest receive, the service fee on top (`bun run bitcoin -- send <deposit address> 0.0015` for 150 000 sat, of which the user gets 148 514 at 1 %). The transfer shows "Deposit seen" with the terms the deposit set; mine two blocks (`bun run bitcoin -- mine 2`) and it shows "Funds received". "Send Cashu" pays the user's payment request from this wallet, so it needs ecash at the mint first, e.g. from an earlier on-chain send.
6. Refunds: for an on-chain receive, pay the refund address (or the address the deposit came from) from the `operator` wallet and paste the txid; for an on-chain send, "Refund Cashu" sends the received ecash back in the chat.
