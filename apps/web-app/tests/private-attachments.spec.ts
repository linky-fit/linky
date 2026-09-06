import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { setBaseStorage, MOBILE_VIEWPORT } from "./helpers/appState";
import { addContactByNpub } from "./helpers/contacts";
import { watchAppErrors } from "./helpers/diagnostics";
import { createSeedIdentity, setSeedLoginStorage } from "./helpers/identity";
import { stubFiatRates, stubThirdPartyAssets } from "./helpers/network";

const makePdf = (): Buffer => {
  const stream = "BT /F1 24 Tf 40 100 Td (Private attachment smoke) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 180] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let document = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(document));
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(document);
  document += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1))
    document += `${String(offset).padStart(10, "0")} 00000 n \n`;
  document += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(document);
};

test("private images and PDFs reach a peer, decrypt, save and share with seen receipts", async ({
  browser,
}, testInfo) => {
  const blobs = new Map<string, Buffer>();
  const accounts = [];
  for (const label of ["attachment sender", "attachment receiver"]) {
    const context = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      serviceWorkers: "block",
      viewport: MOBILE_VIEWPORT,
    });
    const page = await context.newPage();
    const errors = watchAppErrors(page, label);
    const identity = await createSeedIdentity();
    await setBaseStorage(page);
    await setSeedLoginStorage(page, identity);
    await page.addInitScript(() => {
      localStorage.setItem("linky.seen_receipts_enabled_at_sec.v1", "1");
      Object.defineProperty(navigator, "canShare", { value: () => true });
      Object.defineProperty(navigator, "share", {
        value: async (data: ShareData) => {
          const file = data.files?.[0];
          if (!file) throw new Error("Expected a shared file");
          sessionStorage.setItem(
            "e2e.shared-file",
            JSON.stringify({
              name: file.name,
              type: file.type,
              bytes: Array.from(new Uint8Array(await file.arrayBuffer())),
            }),
          );
        },
      });
    });
    await stubFiatRates(page);
    await stubThirdPartyAssets(page);
    // Store the actual encrypted upload and return it to either browser.
    await page.route("https://blossom.primal.net/**", async (route) => {
      const request = route.request();
      const headers = { "Access-Control-Allow-Origin": "*" };
      if (request.method() === "PUT") {
        const body = request.postDataBuffer();
        if (!body) throw new Error("Empty attachment upload");
        const sha256 = createHash("sha256").update(body).digest("hex");
        const url = `https://blossom.primal.net/${sha256}`;
        blobs.set(url, body);
        await route.fulfill({ headers, json: { url, sha256 } });
        return;
      }
      const body = blobs.get(request.url());
      if (!body) throw new Error(`Unknown attachment ${request.url()}`);
      await route.fulfill({ headers, body, contentType: "text/plain" });
    });
    await page.goto("/#wallet");
    await expect(page.getByLabel("Available balance")).toBeVisible();
    accounts.push({ context, page, identity, errors });
  }
  const [sender, receiver] = accounts;
  try {
    await addContactByNpub(sender.page, receiver.identity.npub);
    await addContactByNpub(receiver.page, sender.identity.npub);
    const png = await sender.page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 64;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("No canvas context");
      context.fillStyle = "#3498db";
      context.fillRect(0, 0, 64, 64);
      return canvas.toDataURL("image/png").split(",")[1];
    });
    const files = [
      {
        name: "smoke.png",
        mimeType: "image/png",
        buffer: Buffer.from(png, "base64"),
        selector: ".chat-private-image-button img",
      },
      {
        name: "smoke.pdf",
        mimeType: "application/pdf",
        buffer: makePdf(),
        selector: ".chat-private-pdf-preview img",
      },
    ];
    for (const file of files) {
      await test.step(`send, decrypt and export ${file.name}`, async () => {
        await sender.page.locator(".chat-image-input").setInputFiles({
          name: file.name,
          mimeType: file.mimeType,
          buffer: file.buffer,
        });
        const message = receiver.page.locator(".chat-message.in").last();
        await expect(message.locator(file.selector)).toBeVisible();
        await expect
          .poll(() =>
            message
              .locator(file.selector)
              .evaluate(
                (element) =>
                  element instanceof HTMLImageElement &&
                  element.complete &&
                  element.naturalWidth > 0,
              ),
          )
          .toBe(true);
        await expect(
          sender.page.locator(".chat-message.out").last(),
        ).toHaveClass(/seen/);
        await message.locator(".chat-bubble").click({ button: "right" });
        const downloadEvent = receiver.page.waitForEvent("download");
        await receiver.page
          .getByRole("menu")
          .getByRole("button", { name: /^(Save|Save to photos)$/, exact: true })
          .click();
        const download = await downloadEvent;
        const path = await download.path();
        if (!path) throw new Error("Missing downloaded file");
        const saved = await readFile(path);
        expect(saved.length).toBeGreaterThan(0);
        if (file.mimeType === "application/pdf")
          expect(saved).toEqual(file.buffer);
        expect([...blobs.values()].some((blob) => blob.equals(saved))).toBe(
          false,
        );
        await message.locator(".chat-bubble").click({ button: "right" });
        await receiver.page
          .getByRole("menu")
          .getByRole("button", { name: "Share", exact: true })
          .click();
        await expect
          .poll(() =>
            receiver.page.evaluate(() =>
              sessionStorage.getItem("e2e.shared-file"),
            ),
          )
          .toBe(
            JSON.stringify({
              name: download.suggestedFilename(),
              type:
                file.mimeType === "application/pdf"
                  ? "application/pdf"
                  : "image/jpeg",
              bytes: Array.from(saved),
            }),
          );
        await testInfo.attach(file.name, {
          body: await receiver.page.screenshot(),
          contentType: "image/png",
        });
      });
    }
    for (const account of accounts) account.errors.assertClean();
  } finally {
    for (const account of accounts) await account.context.close();
  }
});
