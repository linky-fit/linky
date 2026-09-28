import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";

const { chromium } = await import(
  new URL(
    "../../../apps/web-app/node_modules/@playwright/test/index.mjs",
    import.meta.url,
  )
);
const bundle = await readFile(process.argv[2]);
const server = createServer((request, response) => {
  response.setHeader(
    "Content-Type",
    request.url === "/browser.js" ? "text/javascript" : "text/html",
  );
  response.end(
    request.url === "/browser.js"
      ? bundle
      : '<body><script type="module" src="/browser.js"></script>',
  );
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
if (!address || typeof address === "string")
  throw new Error("No browser test port");
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("pageerror", (error) => console.error(error));
  await page.goto(`http://127.0.0.1:${address.port}`);
  await page.waitForFunction(() => document.body.textContent === "passed");
  console.log("Packed packages: Chromium consumer passed");
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
