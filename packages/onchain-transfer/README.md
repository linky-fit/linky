# @linky-fit/onchain-transfer

The on-chain transfer domain: a Linky user moves bitcoin between their ecash at the on-chain operator's mint and an on-chain wallet, and the on-chain operator completes each transfer by hand. `@linky-fit/linksync` stores the `onchainTransfer` rows and linkstr carries the messages; this package owns everything between them and the two apps:

- **Messages** (`messages.ts`) — the `OnchainTransferRequest`, `OnchainTransferCancel` and `OnchainTransferUpdate` schemas, the `onchainTransferChannel` they travel on, which update wins, and the stored `updateJson` column.
- **Statuses** (`status.ts`) — the operator's statuses and which move from which.
- **Phases** (`phase.ts`) — what Linky shows for a transfer, and when the user may still cancel it.
- **Fees** (`fees.ts`) — the service fee in basis points, charged on top of the transfer amount.
- **Config** (`config.ts`) — the operator's public NIP-78 on-chain config.
- **Bitcoin** (`bitcoin.ts`) — BIP86 deposit addresses, address validation per network, BIP21 URIs and explorer links.
- **Esplora** (`esplora.ts`) — a client for the Esplora HTTP API and the deposit status of an address.

Environment-agnostic: no React, Evolu, browser storage or i18n; `nowSec` is always an argument and `fetch` is passed in. Transfers carry the shared `OnchainTransferId` brand from `@linky-fit/domain`. See [`docs/`](./docs/README.md) for usage and [`AGENTS.md`](./AGENTS.md) for the rules.
