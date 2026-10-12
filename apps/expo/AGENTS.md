# @linky-fit/expo

Builds `apps/linky-app` for the web with Expo/Metro and expo-router. This package holds bundler glue only; app code, `index.html`, `public/` files and the PWA manifest (`server/webManifest.ts`) live in `apps/linky-app`, and `scripts/preparePublic.ts` regenerates `public/` from them.

- Metro resolves `apps/linky-app/src/platform/buildEnv.ts` to `src/buildEnv.ts` and `platform/navigation.ts` to `src/navigation.tsx`. A change to either seam goes into both; the `*.contract.ts` files fail the typecheck until they match.
- The app shell renders beside `ExpoRoot`, never inside the router: expo-router rebuilds its route tree for history entries it did not create, which would remount the app. The seam writes the URL through the History API and expo-router follows it; `app/` routes render nothing and only claim the URL space.
- Payment details and command-link payloads stay out of URL paths and queries. A bank payment URL carries an `spd-<id>` whose SPAYD waits in sessionStorage (`src/routeUrl.ts`); fragments such as `#add/…` or `#linkauth…` stay fragments for their handlers.
- Every server of the export answers a path outside `/_expo/`, `/assets/` and the static directories with `index.html`: `docker/linky-app/nginx.conf`, `scripts/serve.ts` and the service worker's navigation route do.
- Production serves the service worker at `/sw.js`, scope `/`, as a classic script, the same as the Vite build. Installed apps treat a changed URL or type as an update.
- The Expo dev server runs without a service worker.
- Production builds tree-shake, which drops Metro's worker bundles. A web worker the app starts gets a Bun bundle in `scripts/build.ts`, as `evoluDb.worker.ts` has.
- `scripts/bundleSize.ts` holds the gzip budget for the exported JS. Raise it in the same change that adds the bytes.
