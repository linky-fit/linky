# Releases

The web app has two channels. Both run against production relays, Evolu servers, mints and the push server, so the same account works on either.

| Channel | Source                                         | Domain                  |
| ------- | ---------------------------------------------- | ----------------------- |
| Nightly | every push to `main`                           | `nightly.app.linky.fit` |
| Prod    | the `production` branch, moved by each release | `app.linky.fit`         |

The site (`linky.fit`), the push server and the npm packages keep shipping from `main`. The desktop shell loads `app.linky.fit`, so it follows prod.

## Shipping a release

1. Move the `[Unreleased]` entries in `CHANGELOG.md` under the new version; `[Unreleased]` describes what nightly has on top of prod.
2. Bump `version` in the root `package.json` and merge to `main`.

The `Release` workflow (`.github/workflows/android-apk-release.yml`) runs e2e, creates the `v<version>` tag and GitHub release, then publishes Android, macOS and Zapstore and force-pushes `production` to the tag. Vercel builds `production` and assigns `app.linky.fit` once the `e2e` Deployment Check passes.

## Hotfix

Branch from the release tag, fix, bump `version`, push a `v<version>` tag. The tag run ships it like any release. Cherry-pick the fix to `main` as well, or the next release drops it.

## Rollback

Use Instant Rollback in Vercel, or run the `Release` workflow manually with an older tag. The rollback only lasts until the next release moves `production`.

## Compatibility

A nightly device writes to the same Evolu owner, Nostr relays and mints as prod devices, for as long as a release cycle lasts. Whatever nightly writes must stay readable by the last release.

A new origin has its own local storage, so nightly starts empty: restore from the seed, and it joins the account as one more device.

## Vercel setup

The web-app project:

- Production branch: `production`, domain `app.linky.fit`, Deployment Check `e2e`.
- Custom Environment `nightly`: tracks `main`, domain `nightly.app.linky.fit`, the same environment variables as Production and no Deployment Protection on its domain.

Pull requests keep their preview deployments. The `production` branch has a ruleset that lets only GitHub Actions push to it.
