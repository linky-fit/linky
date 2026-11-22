---
name: journey-testing
description: Journey tests, where agents click through Linky and Fazole in real browsers on a local stack. Use when asked to run user journeys or to rehearse a release.
---

A journey test is a tester using the apps as a user would, in a real browser, against a local copy of every backend. A maintainer runs it by hand before a release. CI never runs it, so leave it out of workflows.

You orchestrate. Each tester is a delegate that drives browsers and reports findings.

## Steps

1. Run `bun run journey up`. It builds this checkout's apps and the last Linky and Fazole releases as production builds, starts every backend and prints the URLs. It needs `docker`, `jq` and `playwright-cli` on the PATH. `bun run journey` lists the other commands.
2. Pick the lanes from the table below that the change under test reaches. Before a release, run all of them.
3. Start one tester per lane. Give each its lane, its scenarios and [TESTER.md](TESTER.md), which holds the rules, the stack's limits and the finding format. Run about six testers at a time. Memory is the limit, and a swapping host produces timeouts that testers report as app bugs.
4. Merge the testers' findings into `.journey/evidence/FINDINGS.md` as they report. Send back any finding without its "On last release" line: that line decides whether the change under test caused it.
5. Before a release, run the payment benchmark on this checkout and on the last release, as [Benchmark](#benchmark) describes.
6. Write the HTML report to `.journey/evidence/report.html` and present it with a short text summary, as [Report](#report) describes. Then run `bun run journey down`, which also deletes the browser profiles and wallets. The evidence stays in `.journey/`, which git ignores.

## Lanes

| Lane      | Covers                                                                                                                                                                  |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| core      | One account with data in every feature and a counterpart: profile, contacts, chat, payments in chat, listings, settings, then a seed restore on a new device            |
| wallet    | Topups, tokens in and out, Lightning invoices, payment requests both ways, a recurring payment, both mints, moving funds, a payment interrupted by a kill               |
| sessions  | No recovery seed, logout, restore, clearing local data, offline use, two tabs of one account                                                                            |
| devices   | One account on two devices, both writing and both spending                                                                                                              |
| fazole    | A shop on several terminals, every checkout method, a withdrawal, a pledge, a bank QR payment, the same account in Linky                                                |
| browsers  | The core journeys in WebKit and Firefox                                                                                                                                 |
| long tail | On-chain transfers with the operator console, the error tracker                                                                                                         |
| fresh     | A new user's first hour, in Linky and in Fazole                                                                                                                         |
| speed     | Time from tap to "Sent" for a Cashu send and for Lightning invoices below and above the confirmation limit, under added mint latency; a payment the mint leaves pending |

A lane that touches wallets needs the outside world: `bun run journey wallet`, `ln`, `bank` and `bitcoin` play the other party.

## Benchmark

`bun run journey bench` measures the time from tap to "Sent" for a Cashu send and for Lightning invoices below and above the confirmation limit, on wallets of 5, 128 and 512 proofs, with 0, 50 and 150 ms added to every mint request. It takes about eight minutes and prints a table of medians. `bun run journey bench release` measures the last release the same way.

Run both once the testers are done and the main mint is in `auto`, because testers load the same mints. Report both tables. A cell varies by 30 to 50 % between runs of one build, so name a difference only when it is larger than that and a second run repeats it.

`BENCH_RUNS`, `BENCH_FLOWS`, `BENCH_PROOFS`, `BENCH_LATENCY` and `BENCH_CPU_THROTTLE` narrow or widen a run; `apps/linky-app/bench/payments.bench.ts` has their values.

## Report

Write a self-contained HTML report to `.journey/evidence/report.html`. When `html_preview` and `html_render` are available, check it with `html_preview` and show it inline with `html_render`; otherwise link the saved file. Follow it with a short text summary of what passed, what regressed, and which scenarios nobody ran.

Include four sections:

- **Lanes.** Each lane as passed, partial, or failed, with its passed, failed, and skipped scenario counts.
- **Benchmark.** This checkout beside the last release across proof counts and added mint latencies, as an interactive chart and a table. Mark deltas larger than the 30 to 50 % run-to-run noise. Skip this section when no benchmark ran.
- **Findings.** Every finding from `FINDINGS.md`, grouped by severity and split by `On last release`, with `different` before `same` and `not tried`.
- **Not run.** Scenarios nobody ran and why.

Style the page with `html_render`'s theme CSS variables so it matches light and dark themes.
