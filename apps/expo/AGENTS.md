# @linky-fit/expo

Builds `apps/linky-app` for the web with Expo/Metro. This package holds bundler glue only; app code, `index.html`, `public/` files and the PWA manifest (`server/webManifest.ts`) live in `apps/linky-app`, and `scripts/preparePublic.ts` regenerates `public/` from them.

- Metro resolves `apps/linky-app/src/platform/buildEnv.ts` to `src/buildEnv.ts`. A new build-time value goes into both; `src/buildEnv.contract.ts` fails the typecheck until they match.
- Production serves the service worker at `/sw.js`, scope `/`, as a classic script, the same as the Vite build. Installed apps treat a changed URL or type as an update.
- The Expo dev server runs without a service worker.
- Production builds tree-shake, which drops Metro's worker bundles. A web worker the app starts gets a Bun bundle in `scripts/build.ts`, as `evoluDb.worker.ts` has.
- `scripts/bundleSize.ts` holds the gzip budget for the exported JS. Raise it in the same change that adds the bytes.
