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
| Web app, Android, macOS, Zapstore | a release                                        | the release commit's `CI` run                                |
| Site `linky.fit`                  | every push to `main`                             | Vercel Deployment Checks `lint`, `unit-tests` and `site-e2e` |
| Error tracker                     | every push to `main`                             | Vercel Deployment Checks `lint` and `unit-tests`             |
| Push server `push.linky.fit`      | a manual run of `release-push.yml` on `main`     | the `CI` run of `main`'s head                                |
| npm packages                      | a `packages-v*` tag ([guide](./npm-releases.md)) | the tagged commit's `CI` run                                 |

`lint` typechecks, lints and formats the whole repo; `unit-tests` runs the unit tests of every workspace. Both run on every push, without path filters, because a Deployment Check that never reports blocks the deploy.

The site, the error tracker and the push server ship ahead of the web app, so their APIs must keep working with the last release as well as with nightly.

## Workflows

`ci.yml` holds every check and runs once per commit, on pull requests and on pushes to `main` and `hotfix/**`. `release-*` workflows run no tests: they ship a commit only after `.github/actions/require-ci` confirms that all six required checks succeeded on it.

## Shipping a release

1. Move the `[Unreleased]` entries in `CHANGELOG.md` under the new version; `[Unreleased]` describes what nightly has on top of prod.
2. Bump `version` in the root `package.json` and `apps/web-app/package.json`, and in the `apps/web-app` entry of `bun.lock`, which `bun install` leaves alone. Merge to `main`.

`release-app.yml` starts when `CI` succeeds on that commit and stops unless its version has no tag yet. It then creates the `v<version>` tag and GitHub release, publishes Android, macOS and Zapstore, and force-pushes `production` to the tag, which Vercel deploys to `app.linky.fit`. If `CI` fails, nothing ships; re-run the failed jobs, and the release starts once they pass.

## Hotfix

Branch `hotfix/<name>` from the release tag, fix, bump `version` and push the branch. `CI` runs on it, and once it passes, `release-app.yml` ships it like any release. Cherry-pick the fix to `main` as well, or the next release drops it.

## Rollback

Use Instant Rollback in Vercel. It lasts until the next release moves `production`.

To publish a release again, run `Release · app` from its tag (Run workflow → Use workflow from → the tag). Every job then builds that tag's commit; a run started from a branch never republishes an existing tag.

## Compatibility

A nightly device writes to the same Evolu owner, Nostr relays and mints as prod devices, for as long as a release cycle lasts. Whatever nightly writes must stay readable by the last release.

A new origin has its own local storage, so nightly starts empty: restore from the seed, and it joins the account as one more device.

## Vercel and GitHub setup

- Web-app project: production branch `production` with domain `app.linky.fit`, and no Deployment Checks, because `release-app.yml` already gates it. Custom Environment `nightly` tracks `main` with domain `nightly.app.linky.fit`, the same environment variables as Production and no Deployment Protection on its domain.
- Site project: Deployment Checks `lint`, `unit-tests` and `site-e2e`.
- Error tracker project: Deployment Checks `lint` and `unit-tests`.
- The `zapstore` environment admits `main` and `v*` tags, so a release run started from a tag can publish.
- Tags `v*` and `packages-v*` have a ruleset that restricts updates and deletions. Creation stays open, because the release creates `v<version>` with `GITHUB_TOKEN`, which can't bypass rulesets.
- The `main` ruleset requires `lint`, `unit-tests`, `linkshu-integration`, `npm-packages`, `app-e2e` and `site-e2e`.
- The `production` branch has a ruleset that restricts updates and deletions, with the `Linky releases` GitHub App as the only bypass. `release-app.yml` pushes with that app's token, whose credentials (variable `RELEASE_APP_CLIENT_ID`, secret `RELEASE_APP_PRIVATE_KEY`) live in the `Production` environment, which admits only `main` and `v*` tags (a release started by `CI` runs in `main`'s context, hotfixes included); `GITHUB_TOKEN` can't bypass rulesets, and the organization blocks deploy keys.

Pull requests keep their preview deployments.
