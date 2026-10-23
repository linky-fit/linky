# Config

The on-chain operator publishes its terms as a public NIP-78 [app data](../../linkstr/docs/plain-events.md#app-data-nip-78) event in the slot `ONCHAIN_CONFIG_IDENTIFIER` (`linky.onchain-transfer:config`). Publishing replaces the previous config.

`OnchainConfig` holds `v: 1`, `feeBasisPoints` (0 to 10000; 100 is 1 %), `paused`, a `description` of up to 1000 characters, the `amounts` an on-chain send can be made for (positive sats, at least one; `DEFAULT_TRANSFER_AMOUNTS` is 100000, 250000, 500000 and 1000000), the `maxReceiveAmount` (positive sats; `DEFAULT_MAX_RECEIVE_AMOUNT` is 1000000) an on-chain receive can be made for any amount up to, the `mintUrl` every transfer's ecash is at, the bitcoin `network`, the `explorerUrl` links point to and, optionally, `minClientVersion`: the oldest Linky version (CalVer `YY.M.MICRO`) the operator serves.

- The operator publishes with `AppData.publish(onchainConfigDraft(config))`.
- Linky fetches or watches `new AppDataQuery({ authors: [operator], identifiers: [ONCHAIN_CONFIG_IDENTIFIER] })` and reads each event with `decodeOnchainConfig(event)`, which is `Option.none()` for another slot or content the schema rejects. Query by the operator as author: a config from anyone else means nothing.
- `isOfferedAmount(config, direction, amount)` tells whether a transfer of `amount` sats is offered: one of the `amounts` for an on-chain send, a whole number of sats from 1 to `maxReceiveAmount` for an on-chain receive. Linky offers only those and the operator denies any other.
- Linky makes transfers only while `isClientVersionSupported(config, ownVersion)` holds; an older Linky asks its user to update. The operator raises the minimum when the protocol changes in a way older Linky versions cannot follow.

## Service fee

A transfer's `amount` is the transfer amount, what the user gets; `serviceFee(amount, feeBasisPoints)` is `ceil(amount × feeBasisPoints / 10000)` sats on top of it, and `amountWithServiceFee(amount, feeBasisPoints)`, the transfer amount plus the service fee, is what the user sends. A request carries the service fee it was made at, and the operator denies one whose fee is not the current config's, so a fee change never applies to a transfer the user already asked for. The service fee is locked in the `accepted` update. The operator pays the miner fee of on-chain send payouts on top.
