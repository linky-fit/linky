# FeeProbe

`FeeProbe` estimates a mint's Lightning fee. Mints publish no such number (NUT-06 has no field for it), so the only way to learn one is to ask for a melt quote against a real invoice and read the fee reserve. Use it to show "Lightning fee ≈ x %" on a mint page. Nothing is paid.

## Quick example

Prerequisites: a configured runtime ([getting-started.md](./getting-started.md)) and two reachable Lightning-backed mints; nothing is paid, so no balance is needed.

```ts
import { Effect } from "effect";
import { FeeProbe, FeeProbeDraft, MintUrl } from "@linky/linkshu";

const lightningFee = Effect.gen(function* () {
  const feeProbe = yield* FeeProbe;
  const result = yield* feeProbe.probeLightningFee(
    new FeeProbeDraft({
      mint: MintUrl.make("https://cashu.cz"),
      probeMint: MintUrl.make("https://mint.minibits.cash/Bitcoin"),
    }),
  );
  return `${result.percent.toFixed(2)} % (${result.feeReserve} sat on ${result.amount})`;
});
```

## How it works

1. Read the cache. A result for `mint` younger than 24 h is returned as-is; no request is made.
2. Otherwise: create a mint quote for `amount` (default 10 000 sat) at `probeMint` to obtain an invoice, then ask `mint` for a melt quote on that invoice. `feeReserve` and `percent = feeReserve / amount × 100` come from that quote. The whole probe is capped at 15 s.
3. Cache the result, emit a `LightningFeeProbed` inspector row, return.

Pick `probeMint` as a _different_, Lightning-backed mint; a mint quoting a melt to its own invoice is not representative. Linky's `MintsPage` picks one from the production presets and skips test mints entirely.

### What it never does

- Never pays the invoice, mints, or melts. Both quotes are left unpaid and expire on their own.
- Never touches stored proofs, operations, or deterministic counters.
- Never retries on its own; a failure is not cached either (the app keeps a short client-side backoff for failed probes).

## Inputs and outputs

`FeeProbeDraft` (`feeProbe/domain.ts`):

| Field       | Type                      | Notes                                      |
| ----------- | ------------------------- | ------------------------------------------ |
| `mint`      | `MintUrl`                 | mint whose Lightning fee you want          |
| `probeMint` | `MintUrl`                 | another mint that issues the probe invoice |
| `amount`    | `Schema.optional(Amount)` | probe size; default 10 000 sat             |

`LightningFeeProbeResult`:

| Field        | Type                | Notes                                            |
| ------------ | ------------------- | ------------------------------------------------ |
| `mint`       | `MintUrl`           |                                                  |
| `probeMint`  | `MintUrl`           |                                                  |
| `amount`     | `Amount`            | the mint's quoted amount, else the requested one |
| `feeReserve` | `NonNegativeAmount` | sat the mint would reserve                       |
| `percent`    | `Schema.Number`     | `feeReserve / amount * 100`                      |

## Errors

| Tag               | When                                                                                        | What to do                        |
| ----------------- | ------------------------------------------------------------------------------------------- | --------------------------------- |
| `MintUnreachable` | either mint unreachable, or the probe exceeded 15 s                                         | show "unknown"; retry later       |
| `MintRejected`    | a mint answered with an unusable quote (no invoice, no fee reserve) or rejected the request | show "unknown"; `detail` explains |

## Related

- [mints.md](./mints.md) — `MintInfo.inputFeePpk` is the cashu-side fee
- [melt.md](./melt.md) — where the real fee is charged
- [inspector.md](./inspector.md) — `LightningFeeProbed`
