import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:https";
import { pinnedTransport } from "../../api/_safeFetch.js";

const [keyPath, certPath] = process.argv.slice(2);
assert(keyPath && certPath);
const server = createServer(
  { key: readFileSync(keyPath), cert: readFileSync(certPath) },
  (request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ host: request.headers.host }));
  },
);
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
try {
  const address = server.address();
  assert(address && typeof address !== "string");
  const host = `pinning.invalid:${address.port}`;
  const response = await pinnedTransport.request(new URL(`https://${host}/`), [
    { address: "127.0.0.1", family: 4 },
  ]);
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.text), { host });
  await assert.rejects(
    pinnedTransport.request(new URL(`https://wrong.invalid:${address.port}/`), [
      { address: "127.0.0.1", family: 4 },
    ]),
  );
  process.stdout.write(
    "Connected to the pinned TLS address with the original hostname verified.\n",
  );
} finally {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
