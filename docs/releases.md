# Releases

How each Linky target ships, what you do for it, and how to recover when a run fails.

| Target                                                                | Ships                                  | You do                              |
| --------------------------------------------------------------------- | -------------------------------------- | ----------------------------------- |
| Nightly `nightly.app.linky.fit`                                       | every push to `main`                   | nothing                             |
| App: `app.linky.fit`, Google Play, macOS DMG, Zapstore                | a new version merged to `main`         | [release PR](#app)                  |
| Site `linky.fit`                                                      | every push to `main`, after its checks | nothing                             |
| Error tracker                                                         | every push to `main`, after its checks | nothing                             |
| Push server `push.linky.fit`                                          | a manual run                           | [run Release · push](#push-server)  |
| npm `@linky-fit/linkshu`, `@linky-fit/linkstr`, `@linky-fit/linkauth` | a `packages-v*` tag                    | [version PR and tag](#npm-packages) |

The desktop shell loads `app.linky.fit`, so it follows the app release.

## CI gates every release

`ci.yml` runs every check once per commit, on pull requests and on pushes to `main` and `hotfix/**`. The `main` ruleset requires its six checks: `lint` (typecheck, ESLint and Prettier for the whole repo), `unit-tests` (every workspace), `linkshu-integration`, `npm-packages`, `app-e2e` and `site-e2e`.

Release workflows run no tests. They ship a commit only after `.github/actions/require-ci` confirms that all six checks succeeded on it, so a release always ships code its CI run tested. It waits up to 45 minutes for checks that are still running or not yet started, and fails as soon as one fails.

## App

One release ships the web app to `app.linky.fit`, the Android app to Google Play (internal and beta tracks) and GitHub Releases, the macOS DMG and Zapstore. Versions are CalVer `YY.M.MICRO`; MICRO restarts at 1 each month.

### Release

1. On a branch from `main`, move the `[Unreleased]` entries in `CHANGELOG.md` under `## [<version>] - <date>`, `en-US` first, then `cs-CZ`. Each language becomes the Google Play notes and must stay within 500 characters; `apps/native-shell/scripts/extract-release-notes.sh v<version> /tmp/notes <locale>` checks it. Leave an empty `## [Unreleased]` above.
2. Set `version` to the new version in the root `package.json`, `apps/web-app/package.json` and the `apps/web-app` entry of `bun.lock`, which `bun install` leaves alone.
3. Open a PR and merge it once its checks pass.

`CI` runs on the merged commit. When it succeeds, `release-app.yml` starts, confirms the six checks, and, because `v<version>` has no tag yet:

1. `publish` builds the APK and AAB and creates the `v<version>` tag and GitHub release on that commit.
2. In parallel: `web-production` moves `production` to the tag and Vercel deploys `app.linky.fit`; `google-play`, `macos` and `zapstore` publish.

Every other push to `main` also starts `release-app.yml`; it stops after `resolve` because its version is already tagged. Settings > Advanced on `app.linky.fit` shows the new version once the deploy finishes; installed PWAs update through their update prompt.

### When a run fails

- `CI` fails: nothing ships. Fix it on `main` or re-run the failed jobs; the release starts when `CI` passes.
- A job fails before `publish` creates the tag: re-run the failed jobs.
- A job fails after the tag exists: fix the cause outside the code (a secret, an environment, a store setting) and re-run the failed jobs. The tag can't move, so a code fix ships as a new version, through a [hotfix](#hotfix) if `main` isn't ready.
- To publish an existing tag again after its run is gone, run `Release · app` from the tag (Run workflow → Use workflow from → `v<version>`). A run started from a branch never republishes an existing tag.

### Hotfix

1. Create `hotfix/<name>` from the release tag.
2. Commit the fix, bump `version` as in a release, and push the branch.
3. `CI` runs on the branch; once it passes, `release-app.yml` ships it.
4. Cherry-pick the fix to `main`, or the next release drops it.

Don't open a PR from a hotfix branch; the push already runs `CI`, and a PR would run it twice.

### Rollback

Use Instant Rollback in the Vercel web-app project. It lasts until the next release moves `production`. Google Play and Zapstore have no rollback; ship a hotfix instead.

## Nightly

Every push to `main` deploys to `nightly.app.linky.fit` right away, against production relays, Evolu servers, mints and the push server. Settings > Advanced shows `<last release> nightly (<sha>)`.

A nightly device writes to the same Evolu owner, Nostr relays and mints as prod devices for a whole release cycle, so whatever nightly writes must stay readable by the last release. Nightly is a separate origin with its own local storage: restore from the seed, and it joins the account as one more device.

## Site and error tracker

Every push to `main` builds both on Vercel, and each goes live once its Deployment Checks pass on that commit: `lint`, `unit-tests` and `site-e2e` for the site, `lint` and `unit-tests` for the error tracker. A failing check keeps the previous deployment live; the next passing push replaces it.

They ship ahead of the app, so their APIs must keep working with the last app release as well as with nightly.

## Push server

Actions → `Release · push` → Run workflow on `main`. From any other branch every job is skipped.

The run waits for `CI` on `main`'s head to finish and confirms its six checks, builds `ghcr.io/linky-fit/linky-push` as `:latest` and `sha-<commit>`, and deploys it over SSH, restarting only the `push` service. It fails unless the server reports the commit it built and `/health` answers. A failed run leaves the previous container running; fix the cause and run it again.

Like the site, the push server ships ahead of the app and must keep working with the last app release.

## npm packages

`@linky-fit/linkshu`, `@linky-fit/linkstr` and `@linky-fit/linkauth` share one SemVer version and publish together; [npm-releases.md](./npm-releases.md) has the details.

1. Set the same `version` in all three packages' `package.json` and in their `bun.lock` entries, and merge to `main`.
2. Tag the merged commit and push the tag:

   ```bash
   git fetch origin
   git tag packages-v<version> origin/main
   git push origin packages-v<version>
   ```

`release-npm.yml` waits for `CI` on the tagged commit, confirms its six checks and publishes the tarballs that commit's `CI` run built. If one package fails after the other published, re-run the failed jobs. Tags can't be moved or deleted and npm never reuses a version, so a release that can't be fixed by a re-run needs the next version.

## Vercel and GitHub setup

- Web-app project: production branch `production` with domain `app.linky.fit` and no Deployment Checks, because `release-app.yml` gates it. Custom Environment `nightly` tracks `main` with domain `nightly.app.linky.fit`, the same environment variables as Production and no Deployment Protection on its domain.
- Site project: Deployment Checks `lint`, `unit-tests` and `site-e2e`.
- Error tracker project: Deployment Checks `lint` and `unit-tests`.
- The `main` ruleset requires `lint`, `unit-tests`, `linkshu-integration`, `npm-packages`, `app-e2e` and `site-e2e`.
- The `production` branch has a ruleset that restricts updates and deletions, with the `Linky releases` GitHub App as the only bypass. `release-app.yml` pushes with that app's token, whose credentials (variable `RELEASE_APP_CLIENT_ID`, secret `RELEASE_APP_PRIVATE_KEY`) live in the `Production` environment, which admits only `main` and `v*` tags (a release started by `CI` runs in `main`'s context, hotfixes included); `GITHUB_TOKEN` can't bypass rulesets, and the organization blocks deploy keys.
- Tags `v*` and `packages-v*` have a ruleset that restricts updates and deletions. Creation stays open, because the release creates `v<version>` with `GITHUB_TOKEN`.
- The `zapstore` environment admits `main` and `v*` tags, so a release run started from a tag can publish.
- npm: the trusted publisher of both packages names `release-npm.yml`, with no environment or the `npm` environment.
- The README badges read GitHub deployments: `Production` (app release), `Production – linky-website` (Vercel), `push` (`release-push.yml`) and `npm` (`release-npm.yml`). A job using an environment records a deployment, and GitHub creates the `push` and `npm` environments on their first run.

Pull requests keep their preview deployments.
