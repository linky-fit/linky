# Production build of the web app, served for the `local-stack` Playwright project.
#
# A production build rather than a dev server: it exercises the `manualChunks`
# splitting (a bug class that only exists in a real build) and runs effects
# once instead of twice under StrictMode — exactly as for users.
#
# Vite inlines `import.meta.env` at build time and `vite build` does not load
# .env.development, so these ARGs are the only source of the endpoints.

FROM oven/bun:1.3.9-alpine AS build
WORKDIR /app

# Manifests first so editing source does not bust the dependency layer.
COPY package.json bun.lock ./
COPY patches patches
COPY apps/linkshu-cli/package.json apps/linkshu-cli/
COPY apps/native-shell/package.json apps/native-shell/
COPY apps/push/package.json apps/push/
COPY apps/site/package.json apps/site/
COPY packages/ui/package.json packages/ui/
COPY apps/ui-book-next/package.json apps/ui-book-next/
COPY apps/web-app/package.json apps/web-app/
COPY packages/config/package.json packages/config/
COPY packages/identity/package.json packages/identity/
COPY packages/linkshu/package.json packages/linkshu/
COPY packages/linkstr/package.json packages/linkstr/
COPY packages/linkstr-react/package.json packages/linkstr-react/
COPY tools/nostr-error-tracker/package.json tools/nostr-error-tracker/
RUN bun install --frozen-lockfile

COPY . .

ARG VITE_NOSTR_RELAYS
ARG VITE_EVOLU_SERVER_URLS
ARG VITE_MAIN_MINT_URL
ARG VITE_NPUB_CASH_DISABLED
ARG VITE_PUSH_SERVER_URL
ENV VITE_NOSTR_RELAYS=$VITE_NOSTR_RELAYS \
    VITE_EVOLU_SERVER_URLS=$VITE_EVOLU_SERVER_URLS \
    VITE_MAIN_MINT_URL=$VITE_MAIN_MINT_URL \
    VITE_NPUB_CASH_DISABLED=$VITE_NPUB_CASH_DISABLED \
    VITE_PUSH_SERVER_URL=$VITE_PUSH_SERVER_URL

WORKDIR /app/apps/web-app
# Sourcemaps keep Playwright traces readable; passed on the CLI so this test
# setup stays out of vite.config.ts. No typecheck here — the e2e workflow
# runs it as a separate step, off the image-build critical path.
RUN ./node_modules/.bin/vite build --sourcemap

FROM nginx:alpine
# nginx >= 1.21.2 required: its mime.types maps .wasm to application/wasm,
# without which instantiateStreaming rejects and Evolu never initialises.
# (In dev a Vite plugin sets that Content-Type; here it is a plain static asset.)
COPY --from=build /app/apps/web-app/dist /usr/share/nginx/html
COPY docker/web-app/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
