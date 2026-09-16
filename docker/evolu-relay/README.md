# Evolu relay image

The image runs `@evolu/nodejs` with the protocol-compatible versions pinned in `package.json`.

Each owner can store **100 MiB of encrypted history** by default. Set `EVOLU_OWNER_QUOTA_BYTES` to a non-negative decimal integer to override the limit; `0` explicitly disables it. Empty, fractional, negative, non-decimal, and unsafe integer values abort startup. The quota counts encrypted changes, not total SQLite file size or total server disk usage. Operators still need disk monitoring and network-level abuse controls because an open relay can receive many different owners.

Before deploying this default over an existing unlimited database, check owner usage and set a higher explicit limit if needed. Existing history is preserved, and owners already above the limit can read it, but their new writes fail until capacity increases. This image does not delete data or rotate owners.

`docker-compose.dev.yml` explicitly keeps the normal development relay unlimited and the isolated quota-test relay at 16 KiB. Production deployments should omit the override or set their finite capacity deliberately.

Routine Evolu traffic logging is disabled. Startup reports the port and configured quota; shutdown and fixed error categories remain visible. Logs omit owner IDs, protocol payloads, and raw upstream error objects.

Build and run the protocol-level regression tests from the repository root:

```sh
docker build -t linky-evolu-relay docker/evolu-relay
docker run --rm -v "$PWD/docker/evolu-relay/relay.test.js:/app/relay.test.js:ro" linky-evolu-relay npm test
```

The tests start real relay processes with isolated databases, exercise cumulative per-owner quota errors over WebSocket, check default/unlimited/invalid configuration, and verify log privacy. CI runs them using the same image as the local-stack E2E tests.
