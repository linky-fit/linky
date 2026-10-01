# Zapstore publishing

The `zapstore` job in `.github/workflows/android-apk-release.yml` publishes the same signed `linky.apk` the release workflow uploads to GitHub Releases: a clean runner downloads it, verifies the pinned `zsp` binary checksum and runs `zsp publish zapstore.yaml`. The job needs the `ZAPSTORE_NSEC` environment secret and fails, without printing anything, when the secret is missing or is not an `nsec`.

## One-time setup

1. Pick the Nostr identity that publishes Linky releases. `zapstore.yaml` currently uses the public Linky contact key `npub1kkht6jvgr8mt4844saf80j5jjwyy6fdy90sxsuxt4hfv8pel499s96jvz8`; a dedicated store identity is preferable, so replace the `pubkey` before the first publish if you have one.
2. Have the matching private key in `nsec1...` format.
3. In the repository's **Settings → Environments**, create the environment `zapstore` with the secret `ZAPSTORE_NSEC` set to the complete `nsec1...` for the `pubkey` in `zapstore.yaml`.
4. Restrict the environment's deployment branches and tags to the protected `main` branch and release tags (`v*`). Do not add required reviewers if publishing must stay automatic.
5. Run the first publish locally with the release signing keystore available; it links the APK signing certificate to the Nostr identity:

   ```bash
   go install github.com/zapstore/zsp@v0.4.14
   read -r -s ZAPSTORE_NSEC
   SIGN_WITH="$ZAPSTORE_NSEC" zsp publish --wizard
   unset ZAPSTORE_NSEC
   ```

   `read -s` keeps the `nsec` out of shell history.

## Key handling

- The `nsec` is a long-lived unrestricted signing key. A bunker with signing restrictions is preferable; the environment secret is the fallback. Never use a personal key or one that controls funds.
- Keep the secret confined to the final `zsp publish` step, on a runner separate from the app build and its third-party dependencies.
- Before advertising Zapstore as an update path from Google Play, verify that the Play-distributed app and the direct APK share the same signing certificate.
