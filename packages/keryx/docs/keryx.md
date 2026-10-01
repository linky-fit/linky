# Keryx client

Keryx is a signed one-way broadcast from a company to its customers: HTTPS, a QR code with a join URL, TUF metadata and Ed25519 signatures. This package is the client side in full mode. It parses join URLs, pairs with a company, refreshes it and verifies every announcement before handing it out. It never reads a clock and never touches the network on its own: every call takes `now` and an injected `fetch`, and `globalThis.fetch` works.

## Pairing

1. Parse what the user scanned with `parseJoinUrl(text)`. It returns `Result.succeed(JoinRequest)` or a `KeryxJoinUrlInvalid` / `KeryxJoinVersionUnsupported` failure. Nothing is fetched yet.
2. Show `request.origin` and ask the user to confirm it. Show nothing else on that screen: no name, no logo. The origin is ASCII, with punycode for IDNs.
3. After confirmation call `pairCompany({ origin, privateFeeds, fetch, now })`. It pins the root served at `<origin>/.well-known/keryx/root.json` (trust on first use), walks any newer `N.root.json` from the same place, and verifies timestamp, snapshot and targets.
4. Show the consent summary from the `CompanySnapshot`: `identity` (company name and logo, always next to the origin, never badged as verified), `catalog` (every public channel with its display name), `request.channels` preselected, and `privateFeeds`. A private feed whose `info` is `null` matches no master-signed pattern: drop it.
5. When the user subscribes, persist `origin`, `trust`, `identity`, the chosen channels and each authorized private feed as `{ url, closed: false }`, then call `refreshCompany` to load content.

```ts
import { Effect, Result } from "effect";
import { pairCompany, parseJoinUrl } from "@linky-fit/keryx";

declare const scanned: string;
declare const confirmOrigin: (origin: string) => Promise<boolean>;

const request = parseJoinUrl(scanned);
if (
  Result.isSuccess(request) &&
  (await confirmOrigin(request.success.origin))
) {
  const snapshot = await Effect.runPromise(
    pairCompany({
      origin: request.success.origin,
      privateFeeds: request.success.privateFeeds,
      fetch: globalThis.fetch,
      now: new Date(),
    }),
  );
}
```

A payload-less join (`/join`, `/join/` or the bare origin) has no suggested channels and no private feeds. Any other path without `p` is not a join URL.

## Refreshing

Call `refreshCompany({ subscription, known, fetch, now })` on a timer or a wake-up. Pass the announcements the previous refresh returned as `known`: an item whose bytes still match the index is re-verified from `known` without a download. The result is one of three tags.

| Result      | What to do                                                                                                                                                                                                              |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Refreshed` | Persist `trust` and every `privateFeeds[].state`, replace the stored announcements with `announcements`. On `identityChange: "cosmetic"` ask for a one-tap acknowledgement and store `identity` once the user confirms. |
| `Rebranded` | The company name changed. Show a prominent warning and nothing else from the company until the user scans a fresh QR and pairs again.                                                                                   |
| `Suspended` | A validly signed root does not chain to the pinned one. Hide all content, say this may mean the company's website or keys were compromised, and offer only removal. Never suggest pairing again.                        |

`announcements` is the complete list to show, newest first. It already includes cached copies wherever something could not be refreshed, so replace the stored list instead of merging. Items no longer in a channel's index are absent: unpublished items disappear from display and cache.

Per channel, `channels[]` reports `synced`, `unavailable` (the index failed to verify or download; the channel's cached announcements are kept) or `removed` (the company dropped the channel, or its authors role reaches outside the channel; such a channel is never read in simple mode). Per private feed, `privateFeeds[]` reports:

| Status         | Meaning                                                                          |
| -------------- | -------------------------------------------------------------------------------- |
| `active`       | Verified; its announcements replace the cached ones.                             |
| `closed`       | `expired: true`, a 404/410, or closed before. Stop polling, keep the last items. |
| `stale`        | Past its `expires`. Keep the cache and retry.                                    |
| `unavailable`  | Failed to download or verify, or rolled back. Keep the cache and retry.          |
| `unauthorized` | No pattern authorizes it any more. Stop polling, keep the cached items.          |

`problems` lists items that failed this round, for the inspector. `keptCachedCopy: true` means a transient download failure and the previously verified copy is still shown.

## Guarantees

- Root metadata comes only from the join origin's `/.well-known/keryx/`, never from the repo base. A malformed or unreachable anchor keeps the pinned root in force; only a validly signed root that does not chain suspends. When the next `N.root.json` is missing (404/410), a `root.json` of exactly that version is accepted if it chains and suspends if it does not; a `root.json` further ahead fails the refresh with `KeryxFetchFailed` until the missing link is served, so a negatively cached rotation never suspends.
- Every metadata file is checked for signature threshold, pinned hash and length, version against the versions in `trust`, and expiry. A file the snapshot stops pinning keeps its last seen version in `trust`, so it cannot return at a lower version. Redirects are followed, but a response whose final URL is neither the requested URL nor its canonical form (http to https, www to apex) fails the request.
- Every announcement passed its check right before it was returned. Channel items need the threshold of the channel's authors role, or of the channel role in a simple-mode channel. A failing signature by an authorized key drops the item, signatures by other keys are ignored, and that applies to cached items too, so revoking an author drops their items on the next refresh. Private feeds need the pattern's keys over the whole document, the same `channel`, the signed `url` equal to the fetched one, and a version no older than the stored one.
- Items and private feed documents above 1 MB are refused. An item with a linked `image` and no `image_sha256` is rejected.
- `contentHtml` is the publisher's HTML. Render it in a scriptless sandbox; this package does not sanitize it.

## Linked media

A linked logo, an item `image` with `imageSha256`, or an attachment with `sha256` must be checked before it is shown, opened or saved. `fetchVerifiedMedia({ url, sha256, fetch })` returns the bytes only when they match; on `KeryxMediaUnavailable` show a placeholder and leave the announcement as it is. Inline `data:` URLs need no fetch. An attachment without `sha256` is an ordinary web link.

## Errors

`pairCompany` and `refreshCompany` fail only with these tags. None of them suspends the company; keep what is cached and retry later.

| Error                      | Meaning and recovery                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------- |
| `KeryxFetchFailed`         | Network failure, HTTP error, a cross-origin redirect or a response too large. Retry.                    |
| `KeryxMetadataInvalid`     | Metadata that does not parse, verify or match its pin. Usually a publish in progress; retry.            |
| `KeryxRollbackDetected`    | The repository served metadata older than this device already trusted. Keep the cache, retry later.     |
| `KeryxMetadataExpired`     | The newest verifiable metadata has expired. Show the cache with a "could not refresh" note and retry.   |
| `KeryxLiteModeUnsupported` | The company publishes in lite mode, which this client does not read. Tell the user it is not supported. |
| `KeryxJoinUrlInvalid`      | Only from `pairCompany`: the origin is not an HTTPS origin.                                             |

## Persisted state

`CompanyTrust`, `CompanyIdentity`, `PrivateFeedState`, `Channel` and `Announcement` are effect Schemas; store them with `Schema.fromJsonString(...)`. `trust` holds the pinned root exactly as served plus the metadata versions this device has seen, and it is what makes rollback detectable, so always store the one from the latest `Refreshed`.

## Not supported

Lite mode fails with `KeryxLiteModeUnsupported`. `custom.mirrors` is ignored and everything is fetched from `custom.repo_base`. Plain HTTP is accepted only for loopback hosts, so a publisher can run on `localhost` during development.
