FROM oven/bun:1.3.9-alpine AS build

WORKDIR /app

COPY package.json bun.lock ./
COPY patches patches
COPY apps/linkshu-cli/package.json apps/linkshu-cli/package.json
COPY apps/native-shell/package.json apps/native-shell/package.json
COPY apps/push/package.json apps/push/package.json
COPY apps/site/package.json apps/site/package.json
COPY apps/ui-book/package.json apps/ui-book/
COPY packages/ui/package.json packages/ui/
COPY apps/web-app/package.json apps/web-app/package.json
COPY packages/identity/package.json packages/identity/package.json
COPY packages/linkshu/package.json packages/linkshu/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/linkstr/package.json packages/linkstr/package.json
COPY packages/linkstr-react/package.json packages/linkstr-react/package.json
COPY tools/nostr-error-tracker/package.json tools/nostr-error-tracker/package.json

RUN bun install --frozen-lockfile

COPY apps/push apps/push
COPY packages/linkstr packages/linkstr

RUN bun run --filter @linky/push build

FROM oven/bun:1.3.9-alpine AS runtime

WORKDIR /app

RUN mkdir -p /data && chown bun:bun /data

COPY --from=build /app/apps/push/dist/index.js /app/index.js

ARG GIT_COMMIT_SHA=unknown

ENV NODE_ENV=production
ENV PUSH_PORT=8787
ENV PUSH_STORAGE_PATH=/data/linky-push.sqlite
ENV BUILD_COMMIT_SHA=${GIT_COMMIT_SHA}

USER bun

EXPOSE 8787

VOLUME ["/data"]

CMD ["bun", "/app/index.js"]
