# npm releases

`@linky-fit/linkshu` and `@linky-fit/linkstr` publish together from this repository with one shared SemVer version, independent of the app's CalVer. `@linky-fit/linkstr-react` stays private. The `npm-packages` check in `.github/workflows/ci.yml` builds ESM and declarations, installs the tarballs in a temporary project and exercises Node and Chromium consumers; on a `packages-v*` tag, `.github/workflows/release-npm.yml` requires every CI check to have passed on the tagged commit and publishes the tarballs that commit's CI run built through npm trusted publishing (no `NPM_TOKEN`; public releases get provenance).

## Releasing

While the version is 0.x, a breaking change to an export or documented behavior is a minor bump and anything else a patch. Pull requests leave `version` alone and state their SemVer effect; the bump happens here.

1. Set the same `version` in `packages/linkshu/package.json` and `packages/linkstr/package.json`.
2. Set the same version in the `packages/linkshu` and `packages/linkstr` entries of `bun.lock`; `bun install` leaves workspace versions there alone.
3. Merge the version and the matching documentation changes into `main`.
4. Tag the merged commit on `main` and push the tag:

   ```bash
   git fetch origin
   git tag packages-v0.1.1 origin/main
   git push origin packages-v0.1.1
   ```

One tag publishes both libraries. The workflow waits for `CI` on the tagged commit, so you can tag right after merging; tag within 90 days, while that run's tarballs are kept. The workflow rejects mismatched package versions, tags that do not match the shared version, commits outside `main` history, and prerelease versions. A tag created with `GITHUB_TOKEN` from another workflow does not trigger it; push the tag by hand or with a separately authorized identity.

Each package publishes in its own job. If one fails after the other succeeded, use **Re-run failed jobs** to retry only that package. npm versions are immutable: never rerun a successful publish and never tag a version that was already published.

The npm trusted publisher of both packages names `release-npm.yml`; renaming that file breaks publishing until both packages on npmjs.com name the new one.

## Local verification

```bash
bun run check-code
bun run build:npm
bun run check:npm
```

`check:npm` needs Node 24, npm, Bun and Playwright Chromium (`cd apps/web-app && bunx playwright install chromium`). It takes about a minute because linkstr must send two real keepalives over one WebSocket. It checks declarations under TypeScript's NodeNext resolution, runs the `linkstr/testing` subpath under Vitest, and imports the browser bundles in Chromium. Temporary installs are removed; the verified tarballs stay under `dist/npm/`.

Workspace manifests remain private and point at TypeScript source; only the generated `dist/package.json` is public and points at JavaScript and declarations. Publish the tested `.tgz`, never a workspace directory.
