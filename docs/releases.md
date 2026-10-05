# Releases

The web app has two channels. Both run against production relays, Evolu servers, mints and the push server, so the same account works on either.

| Channel | Source                                         | Domain                  |
| ------- | ---------------------------------------------- | ----------------------- |
| Nightly | every push to `main`                           | `nightly.app.linky.fit` |
| Prod    | the `production` branch, moved by each release | `app.linky.fit`         |

The desktop shell loads `app.linky.fit`, so it follows prod.

## What ships when

| Service                           | Ships                                            | Gated by                                                     |
| --------------------------------- | ------------------------------------------------ | ------------------------------------------------------------ |
| Web app, Android, macOS, Zapstore | a release                                        | `release-app.yml`: all of `ci-checks.yml` and `ci-e2e.yml`   |
| Site `linky.fit`                  | every push to `main`                             | Vercel Deployment Checks `lint`, `unit-tests` and `site-e2e` |
| Error tracker                     | every push to `main`                             | Vercel Deployment Checks `lint` and `unit-tests`             |
| Push server `push.linky.fit`      | a manual run of `release-push.yml` on `main`     | `release-push.yml`: all of `ci-checks.yml`                   |
| npm packages                      | a `packages-v*` tag ([guide](./npm-releases.md)) | `release-npm.yml`: all of `ci-checks.yml`                    |

`lint` typechecks, lints and formats the whole repo; `unit-tests` runs the unit tests of every workspace. Both run on every push, without path filters, because a Deployment Check that never reports blocks the deploy.

The site, the error tracker and the push server ship ahead of the web app, so their APIs must keep working with the last release as well as with nightly.

## Workflows

`ci-*` workflows hold every check and run on pull requests and pushes to `main`. `release-*` workflows ship something and gate on the same checks instead of defining their own.

## Shipping a release

1. Move the `[Unreleased]` entries in `CHANGELOG.md` under the new version; `[Unreleased]` describes what nightly has on top of prod.
2. Bump `version` in the root `package.json` and merge to `main`.

`release-app.yml` runs `ci-checks.yml` and `ci-e2e.yml`: lint, every unit, integration and e2e suite. Only then does it create the `v<version>` tag and GitHub release, publish Android, macOS and Zapstore and force-push `production` to the tag, which Vercel deploys to `app.linky.fit`.

## Hotfix

Branch from the release tag, fix, bump `version`, push a `v<version>` tag. The tag run ships it like any release. Cherry-pick the fix to `main` as well, or the next release drops it.

## Rollback

Use Instant Rollback in Vercel. It lasts until the next release moves `production`.

To publish a release again, run `Release · app` from its tag (Run workflow → Use workflow from → the tag). Every job then tests and builds that tag's commit; a run started from a branch never republishes an existing tag.

## Compatibility

A nightly device writes to the same Evolu owner, Nostr relays and mints as prod devices, for as long as a release cycle lasts. Whatever nightly writes must stay readable by the last release.

A new origin has its own local storage, so nightly starts empty: restore from the seed, and it joins the account as one more device.

## Vercel and GitHub setup

- Web-app project: production branch `production` with domain `app.linky.fit`, and no Deployment Checks, because `release-app.yml` already gates it. Custom Environment `nightly` tracks `main` with domain `nightly.app.linky.fit`, the same environment variables as Production and no Deployment Protection on its domain.
- Site project: Deployment Checks `lint`, `unit-tests` and `site-e2e`.
- Error tracker project: Deployment Checks `lint` and `unit-tests`.
- The `main` ruleset requires `lint`, `unit-tests`, `linkshu-integration`, `npm-packages`, `app-e2e` and `site-e2e`.
- The `production` branch has a ruleset that restricts updates and deletions, with the Linky release GitHub App as the only bypass. `release-app.yml` pushes with that app's token (variable `RELEASE_APP_CLIENT_ID`, secret `RELEASE_APP_PRIVATE_KEY`); `GITHUB_TOKEN` can't bypass rulesets, and the organization blocks deploy keys.

Pull requests keep their preview deployments.
