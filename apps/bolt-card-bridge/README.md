# Linky bolt card bridge

Bun HTTP service that hosts the LNURL-withdraw endpoint of the bolt card a Linky device emulates over NFC, and relays every POS request to that device over a WebSocket. The device verifies the card data, decides the limits and pays the invoice from its own wallet; the bridge holds no funds, keys or state beyond live sockets. Design: [`docs/bolt-card.md`](../../docs/bolt-card.md).

## Endpoints

- `GET /session` (WebSocket): the bridge sends a `challenge`, the device answers `auth` with its card id and a signature over it (`@linky-fit/bolt-card`), the bridge answers `ready`. A newer session for the same card replaces the older one; unauthenticated sockets close after `BOLT_CARD_BRIDGE_AUTH_TIMEOUT_MS`, sessions after `BOLT_CARD_BRIDGE_MAX_SESSION_MS`.
- `GET /w/:cardId?p=&c=`: the URL a POS reads from the card. Forwarded to the device as `withdraw`; its `offer` becomes the LUD-03 `withdrawRequest` with the callback `<BOLT_CARD_BRIDGE_PUBLIC_URL>/cb/:cardId`.
- `GET /cb/:cardId?k1=&pr=`: forwarded as `callback`; the device's `accepted` becomes `{"status":"OK"}`.
- `GET /health`, `GET /` (build commit).

The app arms NFC while it is still connecting, so a POS may arrive before the card's session: its request then waits up to `BOLT_CARD_BRIDGE_SESSION_WAIT_MS` (3 s) for the card to connect, which also covers a phone that reconnects mid-session. At most `BOLT_CARD_BRIDGE_MAX_WAITERS_PER_CARD` requests wait per card and `BOLT_CARD_BRIDGE_MAX_WAITERS` in total; the rest are refused at once. Without a session after the wait, or an answer within `BOLT_CARD_BRIDGE_REQUEST_TIMEOUT_MS`, the POS gets `{"status":"ERROR","reason":"Card is not active"}`. LNURL responses allow any origin, as LUD-01 requires. Requests are rate-limited per client IP and per card. Logs carry no card ids, invoices or client IPs.

## Debug logs

`BOLT_CARD_BRIDGE_DEBUG` is off by default.

- `1` prints one line per message: `pos.request`/`pos.response` for the POS side, `card.send`/`card.reply` (with the request id and latency), `card.timeout`, `card.dropped`, `card.unmatched` and `card.waiting`/`card.waitResolved`/`card.waitTimeout`/`card.waitRejected` for the device side, and `socket.*` for session lifecycle and close codes. The lines show only prefixes of the card id, `p`/`c` and the invoice, and never `k1` (it lets anyone submit an invoice for the tap), signatures, challenges or client IPs.
- `raw` (set in `.env.development`) adds the traffic verbatim: `http.in` with method, full URL, peer IP and the upgrade, origin and user-agent headers; `http.out` with status and body; `http.upgraded`, `ws.open`, `ws.in`/`ws.out` with every frame, and `ws.closing`/`ws.close` with code and reason. It prints `k1`, invoices and IPs, so it is for local debugging only; the bridge warns at startup.

When the device seems not to react, start with the raw lines: no `http.in … upgrade=websocket` means the app never reached the bridge, `ws.close` with code 1006 means the connection dropped, and a `card.send` without a `ws.in` answer means the app got the request but did not reply.

```
[bolt-card-bridge] pos.request endpoint=withdraw card=d0caf048…
[bolt-card-bridge] card.send card=d0caf048… request=1 tag=withdraw p=70AF7D… c=9D07A5…
[bolt-card-bridge] card.reply socket=1 card=d0caf048… request=1 ms=0 tag=offer minMsat=1000 maxMsat=98000 description=Linky
[bolt-card-bridge] pos.response endpoint=withdraw card=d0caf048… status=200 outcome=withdrawRequest ms=1
```

## Run

```bash
bun run --filter @linky-fit/bolt-card-bridge dev     # watch mode, reads the committed .env.development
bun run --filter @linky-fit/bolt-card-bridge test
```

## Environment

`BOLT_CARD_BRIDGE_PUBLIC_URL` is required: the public https origin POS terminals reach. It may carry a base path for the callback URL; the reverse proxy then strips that path, because the bridge serves its endpoints at the root. `.env.example` lists the optional settings: port, timeouts, rate limits and trusted proxies.

`BOLT_CARD_BRIDGE_TRUSTED_PROXY_IPS` is empty by default and follows the same rule as `apps/push`: set it to the exact peer IPs of reverse proxies you control, otherwise every client behind the proxy shares one rate-limit bucket. The proxy must pass WebSocket upgrades through and keep idle sockets open for at least a minute.

## Docker

```bash
docker build -f apps/bolt-card-bridge/Dockerfile --build-arg GIT_COMMIT_SHA="$(git rev-parse HEAD)" -t linky-bolt-card-bridge .
docker run --rm -p 8789:8789 -e BOLT_CARD_BRIDGE_PUBLIC_URL=https://bolt-card.example.com linky-bolt-card-bridge
```

`.github/workflows/bolt-card-bridge-image.yml` publishes `ghcr.io/<owner>/linky-bolt-card-bridge` on pushes to `main` and on `bolt-card-bridge-v*` tags.
