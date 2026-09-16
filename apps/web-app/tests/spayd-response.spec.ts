import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

const probeKey = "linky.test.spayd";
const probeValue = "dummy-value";
const script = `new Image().src='/__spayd-leak?value='+localStorage.getItem('${probeKey}');localStorage.setItem('${probeKey}','executed')`;
const payment = "SPD*1.0*ACC:CZ6508000000192000145399*AM:10.00*CC:CZK";

test.use({ serviceWorkers: "allow" });

for (const scenario of [
  { name: "HTML", type: "text/html", data: `<script>${script}</script>` },
  {
    name: "SVG",
    type: "image/svg+xml",
    data: `<svg xmlns="http://www.w3.org/2000/svg"><script>${script}</script></svg>`,
  },
  {
    name: "XHTML in a payment note",
    type: "application/xhtml+xml",
    data: `${payment}*MSG:<script>${script}</script>`,
  },
  { name: "valid payment", type: "", data: payment },
]) {
  test(`SPAYD serves ${scenario.name} only as an inert payment file`, async ({
    page,
  }) => {
    const leakRequests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/__spayd-leak") {
        leakRequests.push(request.url());
      }
    });

    await page.goto("/password-save.html");
    await page.evaluate(
      async ({ key, value }) => {
        localStorage.setItem(key, value);
        await navigator.serviceWorker.register("/sw.js");
        await navigator.serviceWorker.ready;
      },
      { key: probeKey, value: probeValue },
    );
    await page.waitForFunction(
      () => navigator.serviceWorker.controller !== null,
    );

    const url = new URL("/platba.spayd", page.url());
    const params = new URLSearchParams({ data: scenario.data });
    if (scenario.type) {
      params.set("type", scenario.type);
      params.set("disposition", "inline");
      params.set("filename", "attack.html");
    }
    url.search = params.toString();

    const responsePromise = page.waitForResponse(url.toString());
    const body = await page.evaluate(async (url) => {
      const response = await fetch(url);
      return response.text();
    }, url.toString());
    const response = await responsePromise;
    expect(response.fromServiceWorker()).toBe(true);
    expect(response.status()).toBe(200);
    expect(response.headers()).toMatchObject({
      "content-type": "application/x-shortpaymentdescriptor; charset=utf-8",
      "content-disposition": 'inline; filename="platba.spayd"',
      "content-security-policy": "default-src 'none'; sandbox allow-downloads",
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
    });
    expect(body).toBe(scenario.data);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      expect(page.goto(url.toString())).rejects.toThrow(/Download is starting/),
    ]);
    expect(download.suggestedFilename()).toBe("platba.spayd");
    const path = await download.path();
    if (!path) throw new Error("Missing SPAYD download");
    expect(await readFile(path, "utf8")).toBe(scenario.data);
    expect(
      await page.evaluate((key) => localStorage.getItem(key), probeKey),
    ).toBe(probeValue);
    expect(leakRequests).toEqual([]);
  });
}
