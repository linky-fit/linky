# Zapstore publishing

The `zapstore` job in `.github/workflows/release-linky.yml` publishes the same signed `linky.apk` the release workflow uploads to GitHub Releases: a clean runner downloads it, verifies the pinned `zsp` binary checksum and runs `zsp publish zapstore.yaml`. Its store images come from the `zapstore-screenshots` job, which renders the site's phone demos with `bun run zapstore:screenshots` into the git-ignored `apps/linky-site/zapstore-screenshots/` and hands them over as an artifact. To change which screens Zapstore shows, edit the list in `apps/linky-site/scripts/zapstore-screenshots.ts` and the `images` in `zapstore.yaml` together.

The job needs the `ZAPSTORE_NSEC` environment secret and fails, without printing anything, when the secret is missing or is not an `nsec`.

## One-time setup

1. Pick the Nostr identity that publishes Linky releases. `zapstore.yaml` currently uses the public Linky contact key `npub1kkht6jvgr8mt4844saf80j5jjwyy6fdy90sxsuxt4hfv8pel499s96jvz8`; a dedicated store identity is preferable, so replace the `pubkey` before the first publish if you have one.
2. Have the matching private key in `nsec1...` format.
3. In the repository's **Settings → Environments**, create the environment `zapstore` with the secret `ZAPSTORE_NSEC` set to the complete `nsec1...` for the `pubkey` in `zapstore.yaml`.
4. Restrict the environment's deployment branches and tags to the protected `main` branch and release tags (`v*`). Do not add required reviewers if publishing must stay automatic.
5. Prove that the APK signing certificate belongs to the Nostr identity. Zapstore only lists releases whose certificate has an active ownership proof (NIP-C1, kind `30509`) from the signer; without one every publish is silently dropped. The `zsp` wizard creates the proof from the release keystore and the `nsec`, and renews it the same way; the current proof expires on 2028-10-30:

   ```bash
   go install github.com/zapstore/zsp/v2/cmd/zsp@latest
   cd <repo root>
   export KEYSTORE_PASSWORD=<storePassword from keystore.properties>
   export KEYSTORE_KEY_PASSWORD=<keyPassword from keystore.properties>
   read -r -s SIGN_WITH && export SIGN_WITH
   zsp
   unset SIGN_WITH KEYSTORE_PASSWORD KEYSTORE_KEY_PASSWORD
   ```

   `read -s` keeps the `nsec` out of shell history. When the wizard asks for the signing keystore, give it the path to the release keystore (`~/.keys/linky/linky-upload-key.jks` on the machine that generated it).

## Publishing a release by hand

`zapstore.yaml` names the APK at the Gradle output path, which holds whatever was built last on this machine. To publish the APK from a GitHub release instead, override the source:

```bash
gh release download linky-v<version> --pattern linky.apk --dir "$TMPDIR"
read -r -s SIGN_WITH && export SIGN_WITH
zsp publish zapstore.yaml -s "$TMPDIR/linky.apk"
unset SIGN_WITH
```

`zsp check zapstore.yaml -s <apk>` shows, without signing anything, whether the app is listed, which proof is active and which version code is already published.

## Key handling

- The `nsec` is a long-lived unrestricted signing key. A bunker with signing restrictions is preferable; the environment secret is the fallback. Never use a personal key or one that controls funds.
- Keep the secret confined to the final `zsp publish` step, on a runner separate from the app build and its third-party dependencies.
- Before advertising Zapstore as an update path from Google Play, verify that the Play-distributed app and the direct APK share the same signing certificate.
