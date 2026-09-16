import { decode } from "light-bolt11-decoder";
import type { LightningInvoicePreview } from "./preview";

export interface PayableLightningInvoice extends LightningInvoicePreview {
  amountSat: number;
  expiresAtSec: number;
}

/** Decodes BOLT11 with checksum validation and requires a positive fixed amount. */
export const getPayableLightningInvoice = (
  rawInvoice: string,
): PayableLightningInvoice | null => {
  const invoice = rawInvoice.trim();
  if (invoice.length > 5_000) return null;
  try {
    const decoded = decode(invoice);
    const amountMsat = Number(
      decoded.sections.find((section) => section.name === "amount")?.value,
    );
    const timestamp = decoded.sections.find(
      (section) => section.name === "timestamp",
    )?.value;
    const paymentHash = decoded.sections.find(
      (section) => section.name === "payment_hash",
    )?.value;
    const signature = decoded.sections.find(
      (section) => section.name === "signature",
    )?.value;
    if (
      !Number.isSafeInteger(amountMsat) ||
      amountMsat <= 0 ||
      timestamp === undefined ||
      !Number.isSafeInteger(timestamp) ||
      !paymentHash ||
      !/^[a-f0-9]{64}$/i.test(paymentHash) ||
      !signature ||
      !/^[a-f0-9]{128}0[0-3]$/i.test(signature)
    )
      return null;
    const expiry =
      decoded.sections.find((section) => section.name === "expiry")?.value ??
      3600;
    const expiresAtSec = timestamp + expiry;
    if (!Number.isSafeInteger(expiresAtSec) || expiresAtSec <= timestamp)
      return null;
    return {
      invoice,
      amountSat: Math.ceil(amountMsat / 1000),
      expiresAtSec,
      description:
        decoded.sections.find((section) => section.name === "description")
          ?.value ?? null,
    };
  } catch {
    return null;
  }
};
