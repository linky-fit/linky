FROM oven/bun:1.3.9-alpine AS build

WORKDIR /app

COPY package.json bun.lock ./
COPY patches patches
COPY apps/desktop/package.json apps/desktop/package.json
COPY apps/linkshu-cli/package.json apps/linkshu-cli/package.json
COPY apps/native-shell/package.json apps/native-shell/package.json
COPY apps/push/package.json apps/push/package.json
COPY apps/site/package.json apps/site/package.json
COPY apps/supporter/package.json apps/supporter/package.json
COPY apps/ui-book/package.json apps/ui-book/package.json
COPY apps/web-app/package.json apps/web-app/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/identity/package.json packages/identity/package.json
COPY packages/linkshu/package.json packages/linkshu/package.json
COPY packages/linkstr-react/package.json packages/linkstr-react/package.json
COPY packages/linkstr/package.json packages/linkstr/package.json
COPY packages/linksync/package.json packages/linksync/package.json
COPY packages/proxy-payment/package.json packages/proxy-payment/package.json
COPY packages/recurring-payment/package.json packages/recurring-payment/package.json
COPY packages/supporter/package.json packages/supporter/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY tools/nostr-error-tracker/package.json tools/nostr-error-tracker/package.json

RUN bun install --frozen-lockfile

COPY apps/linkshu-cli apps/linkshu-cli
COPY apps/supporter apps/supporter
COPY packages/identity packages/identity
COPY packages/linkshu packages/linkshu
COPY packages/linkstr packages/linkstr
COPY packages/supporter packages/supporter

RUN bun run --filter @linky-fit/supporter-service build

FROM oven/bun:1.3.9-alpine AS base

WORKDIR /app

RUN mkdir -p /data && chown bun:bun /data

COPY --from=build /app/apps/supporter/dist/index.js /app/index.js

ARG GIT_COMMIT_SHA=unknown

ENV NODE_ENV=production
ENV SUPPORTER_PORT=8788
ENV SUPPORTER_STORAGE_PATH=/data/linky-supporter.sqlite
ENV BUILD_COMMIT_SHA=${GIT_COMMIT_SHA}

USER bun

EXPOSE 8788

VOLUME ["/data"]

CMD ["bun", "/app/index.js"]

# docker-compose.dev.yml only: forwards the localhost ports the browser uses
# to the compose services, so the service reaches the stack under the same URLs.
FROM base AS dev

USER root
RUN apk add --no-cache socat
COPY apps/supporter/docker/forward-ports.sh /usr/local/bin/forward-ports
USER bun

ENTRYPOINT ["forward-ports"]
CMD ["bun", "/app/index.js"]

FROM base AS runtime
