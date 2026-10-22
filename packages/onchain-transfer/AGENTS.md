# @linky-fit/onchain-transfer

Read [`docs/protocol.md`](./docs/protocol.md) before changing a message, a status move or a phase: Linky and the operator app release separately and rely on both.

- Every message and the on-chain config keep validating with the schema of the release that wrote them: add optional fields only, never rename or tighten one.
- Nothing here reads a clock, the network or storage; the apps pass them in.
