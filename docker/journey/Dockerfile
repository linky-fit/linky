# syntax=docker/dockerfile:1
# Production builds of the browser apps for `bun run journey`; each compose service serves one with `vite preview`.
# The build context is the tree to build: this checkout, or a release tag's tree for the last-release origins.
ARG BUN_VERSION
FROM oven/bun:${BUN_VERSION}-alpine
WORKDIR /app
COPY . .
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile

ARG APPS
# The archive of a tag has no .git for the apps' version screens to read the commit from.
ARG GIT_COMMIT_SHA
# Vite inlines import.meta.env at build time; an ARG is in the environment of the RUN below.
ARG VITE_ALLOW_INSECURE_LOCALHOST_RELAYS
ARG VITE_NOSTR_RELAYS
ARG VITE_NOSTR_SEARCH_RELAYS
ARG VITE_EVOLU_SERVER_URLS
ARG VITE_MAIN_MINT_URL
ARG VITE_NPUB_CASH_SERVER_URL
ARG VITE_NPUB_CASH_UPSTREAM_URL
ARG VITE_PUSH_SERVER_URL
ARG VITE_BLOSSOM_SERVER_URL
ARG VITE_ONCHAIN_OPERATOR_NPUB
ARG VITE_BITCOIN_NETWORK
ARG VITE_ESPLORA_URL
ARG VITE_EXPLORER_URL
ARG VITE_E2E
RUN for app in $APPS; do (cd "$app" && ./node_modules/.bin/vite build) || exit 1; done

EXPOSE 80
CMD ["./node_modules/.bin/vite", "preview", "--host", "0.0.0.0", "--port", "80", "--strictPort"]
