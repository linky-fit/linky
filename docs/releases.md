# Releases

The web app has two channels. Both run against production relays, Evolu servers, mints and the push server, so the same account works on either.

| Channel | Source                                         | Domain                  |
| ------- | ---------------------------------------------- | ----------------------- |
| Nightly | every push to `main`                           | `nightly.app.linky.fit` |
| Prod    | the `production` branch, moved by each release | `app.linky.fit`         |

The desktop shell loads `app.linky.fit`, so it follows prod.

## What ships when

| Service                           | Ships                                            | Gated by                                                           |
| --------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------ |
| Web app, Android, macOS, Zapstore | a release                                        | the `Release` workflow: every test suite, e2e and `check-code`     |
| Site `linky.fit`                  | every push to `main`                             | Vercel Deployment Checks `site` and `site-e2e`                     |
| Error tracker                     | every push to `main`                             | Vercel Deployment Check `error-tracker`                            |
| Push image `linky-push:latest`    | a push to `main` that touches `apps/push`        | the `test` job in `push-image.yml`; `Deploy Push Server` is manual |
| npm packages                      | a `packages-v*` tag ([guide](./npm-releases.md)) | the `check` job in `npm-packages.yml`                              |

Each service check (`site`, `error-tracker`, `push`) typechecks the service and runs its unit tests plus the unit tests of every package. These checks run on every push, without path filters, because a Deployment Check that never reports blocks the deploy.

The site, the error tracker and the push server ship ahead of the web app, so their APIs must keep working with the last release as well as with nightly.

## Shipping a release

1. Move the `[Unreleased]` entries in `CHANGELOG.md` under the new version; `[Unreleased]` describes what nightly has on top of prod.
2. Bump `version` in the root `package.json` and merge to `main`.

The `Release` workflow (`.github/workflows/android-apk-release.yml`) runs every unit, integration and e2e suite and `check-code`. Only then does it create the `v<version>` tag and GitHub release, publish Android, macOS and Zapstore and force-push `production` to the tag, which Vercel deploys to `app.linky.fit`.

## Hotfix

Branch from the release tag, fix, bump `version`, push a `v<version>` tag. The tag run ships it like any release. Cherry-pick the fix to `main` as well, or the next release drops it.

## Rollback

Use Instant Rollback in Vercel, or run the `Release` workflow manually with an older tag. The rollback only lasts until the next release moves `production`.

## Compatibility

A nightly device writes to the same Evolu owner, Nostr relays and mints as prod devices, for as long as a release cycle lasts. Whatever nightly writes must stay readable by the last release.

A new origin has its own local storage, so nightly starts empty: restore from the seed, and it joins the account as one more device.

## Vercel and GitHub setup

- Web-app project: production branch `production` with domain `app.linky.fit`, and no Deployment Checks, because the `Release` workflow already gates it. Custom Environment `nightly` tracks `main` with domain `nightly.app.linky.fit`, the same environment variables as Production and no Deployment Protection on its domain.
- Site project: Deployment Checks `site` and `site-e2e`.
- Error tracker project: Deployment Check `error-tracker`.
- The `main` ruleset requires `app-e2e`, `site-e2e`, `unit-tests`, `linkshu-integration`, `check`, `site`, `error-tracker` and `push`.
- The `production` branch has a ruleset that lets only GitHub Actions push to it.

Pull requests keep their preview deployments.
