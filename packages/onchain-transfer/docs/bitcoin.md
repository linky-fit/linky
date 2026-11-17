# Bitcoin

`BitcoinNetwork` is `mainnet`, `testnet` (testnet3 and testnet4), `signet` or `regtest`; the config names it.

## Deposit addresses

The operator gives every on-chain receive an unused BIP86 key-path Taproot address from its account-level extended public key: `m/86'/0'/0'` on mainnet, `m/86'/1'/0'` on the test networks.

- `parseDepositXpub(text, network)` validates what the operator pasted: an `xpub` on mainnet or a `tpub` elsewhere, a public key at account depth, bare or inside a Taproot descriptor (`tr([fingerprint/86'/coin'/account']xpub…/<0;1>/*)`, the form Trezor Suite shows) whose coin type matches the network. It returns the key, or `null`.
- `deriveDepositAddress({ xpub, index, network })` is the receive address `0/index` below that key. It throws for a key that does not decode as the network's (a `tpub` on mainnet, an `xpub` on a test network), so pass one `parseDepositXpub` accepted. After saving a key, show address 0 so the operator can compare it with their wallet.
- `deriveAccountAddress({ xpub, chain, index, network })` is the same for either chain: 0 receives, 1 takes the change of the operator's wallet, so the two together are every address a watch-only view of the account has to check.

The operator app first hands a user the deposit address of their latest closed on-chain receive that no deposit reached, while `addressTransactions` still shows it without history: the user may still pay the address they were shown, and a user who asks again gets the same one. Otherwise it takes the highest stored `addressIndex` plus 1, at 0 without any, and from there skips every address `addressTransactions` shows history for. It accepts nothing while Esplora cannot answer, so a lost store never hands out a used address.

## Addresses and links

- `isValidBitcoinAddress(address, network)` accepts P2PKH, P2SH, P2WPKH, P2WSH and P2TR addresses of that network: `bc1`, `1` and `3` on mainnet; `tb1`, `m`, `n` and `2` on testnet and signet; `bcrt1`, `m`, `n` and `2` on regtest. Bech32 addresses may be all uppercase. Validate payout and refund addresses with it before requesting, and again on the operator side.
- `canonicalBitcoinAddress(address, network)` is the address as Esplora reports it (bech32 lowercased, base58 unchanged), or `null` where `isValidBitcoinAddress` is false. Store and send this form.
- `sameBitcoinAddress(a, b)` compares two addresses, ignoring case for bech32 only; `paysAddress` and `depositStatus` match outputs with it, so an address stored uppercase still matches.
- `bitcoinPaymentUri(address, amountSat)` is the BIP21 URI `bitcoin:<address>?amount=<BTC>` for a QR code; the amount is a decimal without trailing zeros (100000 sat is `0.001`).
- `explorerTxUrl(explorerUrl, txid)` and `explorerAddressUrl(explorerUrl, address)` link into the config's explorer.

## Esplora

`makeEsploraClient({ baseUrl, fetch })` talks to an Esplora HTTP API: mempool.space (`https://mempool.space/api`), Blockstream or a local electrs. Pass `globalThis.fetch`, or a fake in tests. Every call returns an `Effect` that fails with `EsploraError` (`url`, `status` for a non-2xx answer, `message`) when the request fails, the answer is not 2xx, or the body does not decode:

- `addressTransactions(address)`: `GET /address/:address/txs`, the address's mempool transactions and its newest confirmed ones. A fresh deposit address has few.
- `addressStats(address)`: `GET /address/:address`, the funded and spent sums and the transaction count of its confirmed (`chain_stats`) and mempool (`mempool_stats`) transactions; a balance is funded minus spent.
- `tipHeight()`: `GET /blocks/tip/height`.
- `transaction(txid)`: `GET /tx/:txid`.

A transaction carries its outputs (`vout`), its confirmation `status` and, optionally, the addresses its inputs spend (`vin[].prevout.scriptpubkey_address`; a coinbase input has a null `prevout`).

Two pure helpers read the answers:

- `paysAddress(tx, address)` is the sats a transaction sends to the address.
- `depositStatus({ address, transactions, tipHeight })` sums every transaction paying the address into `receivedSat`, lists their `txids`, and reports the smallest `confirmations` among them: a transaction in the tip block has 1, an unconfirmed one 0, and so does an address nothing pays. A deposit counts as received at `REQUIRED_CONFIRMATIONS` once `receivedSat` is at least the transfer's `sendAmount`; a short deposit stays `fundsSeen` for the operator to refund, an extra one is the operator's to settle.

For an on-chain send, fetch the transaction the operator pasted and check `paysAddress(tx, payoutAddress) >= amount` before sending `completed`. For an on-chain receive's refund, the `refundAmount` of the `refunded` update is what the pasted transaction pays the refund address, or the addresses the deposit's inputs spent from for a refund to the sender.
