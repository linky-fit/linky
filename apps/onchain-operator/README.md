# On-chain operator

The console the on-chain operator fulfils on-chain transfers from (see `GLOSSARY.md`, "On-chain transfers"): a small React app on Linky's packages, English only, deployed by hand to https://operator.twoballers.dev. It signs in with the recovery seed of a Linky account dedicated to transfers; Linky knows that account by its npub (`VITE_ONCHAIN_OPERATOR_NPUB`). The protocol is in [`packages/onchain-transfer/docs`](../../packages/onchain-transfer/docs/README.md).

- **Transfers**: open transfers oldest first, then the history. A transfer's page shows what to do next: accept or deny a request, pay the payout address and paste the txid (on-chain send), send the user's ecash (on-chain receive), refund or cancel.
- **Chats**: one NIP-17 chat per user, with their transfers inline.
- **Wallet**: the ecash balance at each mint. It must hold ecash at the transfer mint to pay on-chain receives. "Send Cashu" issues a token of a chosen amount, shown as a QR code to copy or scan; whoever holds it can spend it, and until someone claims it, it is listed under "Sent tokens" with "Take back", which returns it to the balance and voids the copy handed out. "Pay over Lightning" pays a BOLT11 invoice, or a Lightning address with an amount, by a melt: it shows the amount and the most the fees can take, then pays on confirmation. A payment the mint has not settled stays reserved and is settled on the next start.
- **Stats**: for all time, this month or the last 30 days, what users got and sent through completed transfers and the service fees earned, the same per direction, and how many transfers completed, are open, were refunded, cancelled or denied; all time adds a table per month. Transfers count by their request time in the browser's time zone, since completion time is not stored; miner fees the operator paid are not tracked.
- **Settings**: the profile (name, the xpub or Taproot descriptor of a BIP86 wallet account as Trezor Suite or Sparrow shows it, service fee in %, the fixed amounts of an on-chain send, the largest on-chain receive, description, pause switch, minimum Linky version, watchers). An on-chain send is made for one of the fixed amounts and an on-chain receive for any amount up to the largest; the amount is what the user gets, and they send it plus the service fee. Saving publishes the on-chain config and the name as the account's Nostr profile, and shows deposit address #0 to compare with the wallet. Once the profile is saved, the profile picture row picks an image, crops it square to 512 px, uploads it to `blossom.primal.net` signed with the account key and publishes it as the Nostr profile picture right away, without saving the form; removing it unpublishes it the same way.
- **Watchers**: npubs that get a Linky chat message from the operator account whenever something waits for the operator: a new request, ecash to pay out, a confirmed deposit, a cancel after funds moved, or any message someone other than a watcher sends the operator. Messages never quote ecash. Every open device of the operator sends them.

The app checks the deposit address of every open on-chain receive against Esplora every 20 seconds and when the window gets the focus; requests it cannot take (paused, an amount not offered, another fee, address of another network, unpayable payment request) are denied automatically.

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

3. Request a transfer from the dev Linky with experimental features on (Settings > Experimental features): Send > Send to on-chain wallet, or Receive > Receive from on-chain wallet. Then accept it in Transfers; Linky notifies the user and shows the payment or the deposit address.
4. On-chain send: once the user's ecash arrived the transfer shows "Funds received". Pay the payout address, e.g. from the funded `dev` wallet with `bun run bitcoin -- send <payout address> <btc>` or from the `operator` wallet with `bun run bitcoin -- cli -rpcwallet=operator sendtoaddress <payout address> <btc>`, paste the txid and confirm. The app checks that the transaction pays the address what the user gets.
5. On-chain receive: pay the deposit address the transfer amount plus the service fee (`bun run bitcoin -- send <deposit address> 0.00101` for 100 000 sat at 1 %). The transfer shows "Deposit seen"; mine two blocks (`bun run bitcoin -- mine 2`) and it shows "Funds received". "Send Cashu" pays the user's payment request from this wallet, so it needs ecash at the mint first, e.g. from an earlier on-chain send.
6. Refunds: for an on-chain receive, pay the refund address (or the address the deposit came from) from the `operator` wallet and paste the txid; for an on-chain send, "Refund Cashu" sends the received ecash back in the chat.
