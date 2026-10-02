FROM oven/bun:1.3.9-alpine AS build

WORKDIR /app

COPY package.json bun.lock ./
COPY patches patches
COPY apps/bolt-card-bridge/package.json apps/bolt-card-bridge/package.json
COPY apps/desktop/package.json apps/desktop/package.json
COPY apps/linkshu-cli/package.json apps/linkshu-cli/package.json
COPY apps/native-shell/package.json apps/native-shell/package.json
COPY apps/push/package.json apps/push/package.json
COPY apps/site/package.json apps/site/package.json
COPY apps/web-app/package.json apps/web-app/package.json
COPY packages/bolt-card/package.json packages/bolt-card/package.json
COPY packages/identity/package.json packages/identity/package.json
COPY packages/linkshu/package.json packages/linkshu/package.json
COPY packages/linksync/package.json packages/linksync/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/linkstr/package.json packages/linkstr/package.json
COPY packages/linkstr-react/package.json packages/linkstr-react/package.json
COPY packages/proxy-payment/package.json packages/proxy-payment/package.json
COPY tools/nostr-error-tracker/package.json tools/nostr-error-tracker/package.json

RUN bun install --frozen-lockfile

COPY apps/bolt-card-bridge apps/bolt-card-bridge
COPY packages/bolt-card packages/bolt-card

RUN bun run --filter @linky-fit/bolt-card-bridge build

FROM oven/bun:1.3.9-alpine AS runtime

WORKDIR /app

COPY --from=build /app/apps/bolt-card-bridge/dist/index.js /app/index.js

ARG GIT_COMMIT_SHA=unknown

ENV NODE_ENV=production
ENV BOLT_CARD_BRIDGE_PORT=8789
ENV BUILD_COMMIT_SHA=${GIT_COMMIT_SHA}

USER bun

EXPOSE 8789

CMD ["bun", "/app/index.js"]
