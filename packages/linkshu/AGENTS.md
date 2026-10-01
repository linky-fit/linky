# @linky-fit/linkshu

`README.md` and `docs/` ship to npm consumers. Read a vertical's guide before changing it. The guides are in sync when every snippet typechecks against `src/index.ts`, every named field and error tag exists, and a new vertical or port has its own guide linked from `docs/README.md`.

- The public API exposes no raw cashu-ts types.
- No key material is stored; locking keys and signers come in as arguments.
- A new inspector `reason` gets a row in `docs/inspector.md`.
- A vertical's unit test follows `src/receive/Receive.test.ts`: the service over the fake wallet, in-memory ports and recording inspector from `src/testing/`.
