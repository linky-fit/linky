# Evolu relay image

Runs `createRelay` of `@evolu/nodejs` on Node 24 with the versions pinned in `package.json`. Evolu 7 and Evolu 8 clients sync through it, and it keeps the database `data/evolu-relay.db` that the Evolu 7 relay wrote.

Each owner can store 100 MiB of encrypted history by default. `EVOLU_OWNER_QUOTA_BYTES` overrides it (decimal bytes, `0` means unlimited); any other value aborts startup. The quota counts encrypted changes, not SQLite file size, so disk monitoring and abuse controls are still the operator's job.

Deploying the default over an existing unlimited database keeps all history. Owners already above the limit can still read, but their writes fail until the limit is raised. The image never deletes data.

`docker-compose.dev.yml` keeps the development relay unlimited and the quota-test relay at 16 KiB.

Routine traffic logging is off. Startup logs the port and quota; shutdown, malformed protocol messages, storage errors and other relay errors stay visible, and logs omit owner ids and payloads.

## Tests

From the repository root:

```sh
docker build -t linky-evolu-relay docker/evolu-relay
docker run --rm -v "$PWD/docker/evolu-relay/relay.test.js:/app/relay.test.js:ro" linky-evolu-relay npm test
```

The tests start real relay processes and cover per-owner quota errors over WebSocket, quota configuration and log privacy. CI runs them on the same image the E2E tests use.
