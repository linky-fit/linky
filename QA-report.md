# PR 459 browser QA

Chromium, 390×844, real UI interactions against AFTER port 5296 and BEFORE port 5297. Each run used fresh seed identities, separate sender/receiver contexts, 200 sat sender funding, and contacts saved in both directions. Scenario 1 used two pages in the sender context. Fiat rates and third-party images were stubbed; service workers were blocked to make request interception reliable. No source or service changes were made.

## Requested scenarios

| Scenario | Build | Result | Observed evidence |
| --- | --- | --- | --- |
| 1. Two tabs reconnect | AFTER | PASS | One 37 sat token message received; receiver wallet 0→36 sat. Sender 200→162 sat in both tabs. One online `pay.step/start`, one `swap-ok`, one `publish-ok`. Queue contained one 37 sat entry offline, then `[]`. Same counts after 25 seconds, both tabs reloaded, and another 22 seconds. |
| 1. Two tabs reconnect | BEFORE | PASS in observed runs; double-send not reproduced | Same one-token result, sender 162 sat in both tabs, receiver 36 sat, one `start`/`swap-ok`/`publish-ok`, queue `[]`. Repeated with fresh identities. |
| 2. Block mint requests | AFTER | PASS | One online start, one aborted mint proof-status request, one `payment.queuedFailed`, zero `swap-ok`/token messages. Placeholder became `Payment failed: Mint unreachable: NetworkError: Failed to fetch`. Queue `[]`. Unblock, reconnect and reload caused no retry. Sender remained 200 sat, receiver 0 sat. |
| 2. Block mint requests | BEFORE | Reproduced retry bug | Failed placeholder stayed `Queued payment 37 sat → Linky.` and pending; queue retained its one 37 sat entry. 803 aborted requests by first observation after 15 seconds; 807 total. Complete inspector export recorded 803 online starts and one eventual `swap-ok`/`publish-ok`. After unblock and reload, receiver had one 37 sat token and 36 sat wallet balance; sender 162 sat; queue eventually `[]`. |
| 3. Insufficient funds | AFTER | SKIPPED as allowed | While offline, entering 237 sat with 200 sat available disabled the normal Pay button. No queue key/entry was created. Waiting-for-funds retry timing and later top-up delivery could not be exercised through this UI. |

The successful 37 sat transfer cost the sender 38 sat. Its inspector receipt reported a 1 sat fee. Receiver credited 36 sat after its mint fee. Counts above are server-recorded online events; offline inspector requests fail, so localStorage and the actual chat placeholder provide evidence of initial queuing.

## Failure after a successful mint operation

The broad mint block fails at `/v1/checkstate`, before any token can be made. A second fresh-identity run on each build therefore intercepted only POST `/v1/swap`, forwarded it using Playwright `route.fetch()`, saved the real HTTP response, and then aborted delivery to the browser. On both builds the mint's first response was HTTP 200 containing signatures totaling 63 sat. This deliberately tests the ambiguous-success case rather than assuming that a generic network failure happened after token creation.

- AFTER: one online start, one aborted swap response, one `payment.queuedFailed`, zero `swap-ok` and no token received. Queue removed; persistent failed placeholder; no retry after reconnect/reload. Wallet displayed 200 sat; receiver 0 sat.
- BEFORE: 251 starts by the 15-second observation, 252 total. The intercepted responses were one HTTP 200 and 250 HTTP 400 responses. Placeholder stayed queued until unblocking. It then retried and sent one new 37 sat token; receiver balance 36 sat, sender balance 98 sat. Queue finally emptied. The sender's additional 64 sat decrease is recorded separately from the 38 sat successful payment debit.

## Screenshots

- `/tmp/pr459-qa/before-failed-queued.png`
- `/tmp/pr459-qa/after-failed-queued.png`
- `/tmp/pr459-qa/after-s3-blocked.png`

The paired chat screenshots use the completed-swap/lost-response failure at the same stage: 15 seconds after reconnect, before unblocking or reloading. The sender was put offline for 6.5 seconds so retry toasts could expire and the actual placeholder was visible. No DOM or image editing was used.

## Evidence and scripts

`qa.ts` is the browser driver. Run with `bun /tmp/pr459-qa/qa.ts after 1`; builds are `after`/`before`; scenarios are `1`, `2` for broad mint blocking, `2b` for a lost successful swap response, `2c` for the same failure plus a separate explicit payment, and `3` for above-balance UI validation.

`collect-events.py` exports every inspector page. `summarize.py` summarizes JSON reports.

Per-run evidence is in `*-report.json`, `*-browser.json`, and `*-run.log`. `before-s2-events-full.json` preserves the paginated baseline retry storm. The original baseline broad-block capture had only the first 500 inspector rows; its final report was supplemented with that full export. The first baseline scenario-1 run overlapped the next run's inspector clear during final wallet sampling, so its final event list was incomplete. A fresh repeat produced the authoritative `before-s1-report.json`. The first fixed-build scenario-1 immediate balance read returned 0 in tab A; the repeated run sampled settled balances three times and obtained 162 in both tabs. Initial captures are retained as `*-initial-*` artifacts.

## AFTER finding: displayed funds exceed the balance available after recovery

**FAIL in the supplemental spendability check.** The failed queue is correctly dropped, but the wallet can continue displaying 200 sat after an accepted mint swap response is lost. A subsequent, explicitly authorized 37 sat payment reduces the displayed balance to 98 sat, rather than the 162 sat seen for a normal 37 sat payment. There is a 64 sat discrepancy beyond the successful payment's 38 sat debit.

Exact reproduction:

1. Fresh sender and receiver; fund sender with 200 sat and add each other as contacts.
2. Put the sender offline and pay the receiver 37 sat through chat. Confirm one queued placeholder and one localStorage entry.
3. Intercept sender POST `http://localhost:3338/v1/swap`. Forward it to the real mint with `route.fetch()`, wait for HTTP 200, then abort the browser response. The saved response contains signatures totaling 63 sat.
4. Reconnect. AFTER makes one attempt, drops the queue, records one `payment.queuedFailed`, and shows the failed chat placeholder. Pause offline to capture it; unblock the swap; reconnect and reload. Receiver remains at 0 sat. Sender repeatedly displays 200 sat.
5. Make one **new** 37 sat payment through the normal chat Pay flow. Sender now displays 98 sat, receiver 36 sat. Inspector records one additional start with `fromQueue:false`, and the only `swap-ok` has `sendAmount:37`, `feePaid:1`, `changeAmount:98`. The original failed message remains visible beside the new payment.

The follow-up mint requests include HTTP 400 on swap, HTTP 200 on `/v1/restore`, and then HTTP 200 on the successful new swap. The 64 sat did not return during this run. Full seed/wallet recovery was not tested, so this is not a claim of permanent unrecoverability. The baseline's automatic retry also finished at 98 sat under the same lost-response fault; this evidence does not establish that the PR introduced the wallet discrepancy.

Evidence: `after-s2c-report.json`, `after-s2c-browser.json`, `after-s2c-final-wallet.png` showing 200 sat, and `after-s2c-after-explicit-payment.png` showing 98 sat. The supplementary `explicitNewPayment.receiverChat` field was captured while the receiver was on its wallet screen; delivery in this follow-up is evidenced by the receiver's settled 36 sat balance and inspector publication events. The driver now navigates the receiver back to chat before that optional follow-up.

No other AFTER bug was established. A transient immediate zero balance read in the first two-tab run did not recur in the settled repeat. All launched browsers were closed through `finally`; existing services were left running and worktree files were not modified.
