# npm releases

`@linky-fit/linkshu` and `@linky-fit/linkstr` publish together from this repository with one shared SemVer version.
GitHub Actions runs checks, builds ESM and declarations, installs the tarballs in
a temporary project, exercises Node and Chromium consumers, and publishes those
same tarballs to npm. `@linky-fit/linkstr-react` stays private.

## First release setup

1. Arrange npm publish access to the `@linky-fit` scope and enable account 2FA.
2. Merge the release workflow and packaging changes to `main`.
3. Bootstrap each new package with an authenticated local publish of its tested
   tarball, if the package does not yet exist on npm:

   ```bash
   bun install --frozen-lockfile
   cd apps/web-app
   bunx playwright install chromium
   cd ../..
   bun run check:npm
   npm login
   npm publish dist/npm/linky-fit-linkshu-0.1.0.tgz --access public
   npm publish dist/npm/linky-fit-linkstr-0.1.0.tgz --access public
   ```

4. In each npm package's Settings → Trusted publishing, authorize GitHub Actions:
   owner `linky-fit`, repository `linky`, workflow `npm-packages.yml`, no environment.
   Allow direct `npm publish`. No `NPM_TOKEN` repository secret is needed.

See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) for the
account configuration. The workflow uses GitHub-hosted runners and Node 24 with
npm 11.5.1 or newer. Public repository releases receive npm provenance automatically.

Do not push a release tag for a version already bootstrapped manually: npm
versions are immutable. Tag-driven automation starts with the next version.

## Subsequent releases

1. Set the same `version` in `packages/linkshu/package.json` and
   `packages/linkstr/package.json`. The shared SemVer version is independent of
   Linky's app CalVer; both libraries release together.
2. Run `bun install` to update workspace version metadata in `bun.lock`.
3. Merge the version and matching documentation changes into `main`.
4. Tag that commit and push the tag, for example:

   ```bash
   git tag packages-v0.1.1
   git push origin packages-v0.1.1
   ```

The single `packages-v0.1.1` tag publishes both libraries. The workflow rejects
mismatched package versions, tags that do not match their shared version, and
commits outside `main` history. Stable `X.Y.Z` versions are
supported; prerelease tags are not published by this workflow. Creating tags
with `GITHUB_TOKEN` from another workflow does not trigger this workflow; use a
human push or a separately authorized release identity.

Each package publishes in its own job. If one publication fails after the other
succeeds, use GitHub Actions **Re-run failed jobs** to retry only the failed
package. Do not rerun a successful publish: npm versions are immutable.

## Local verification

```bash
bun run check-code
bun run build:npm
bun run check:npm
```

The consumer check needs Node 24, npm, Bun and Playwright Chromium. It takes about
a minute because linkstr must send two real keepalive requests over one WebSocket.
It checks declarations with TypeScript's NodeNext resolution, runs the
`linkstr/testing` subpath under Vitest, and exercises browser imports in Chromium.
Temporary installs are removed; verified tarballs remain under `dist/npm/`.

Workspace package manifests remain private and point to TypeScript source. Only
the generated `dist/package.json` is public and points to JavaScript and declaration
files. Publish the tested `.tgz`, never a workspace directory. No workspace-only
dependencies or build scripts are included in the published manifest.
