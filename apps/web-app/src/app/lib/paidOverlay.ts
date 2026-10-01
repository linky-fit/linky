/** Which way the money went, so the paid overlay can show it at a glance. */
export type PaidOverlayDirection = "in" | "out";

/** The other party, when known: their picture and name go on the overlay. */
export interface PaidOverlayContact {
  name: string | null;
  npub: string | null;
}

export interface PaidOverlayDetails {
  direction: PaidOverlayDirection;
  /** Shown large under the headline; null when the amount is not known. */
  amountSat?: number | null;
  contact?: PaidOverlayContact | null;
}

/** Trims a contact-like row down to what the overlay shows; null when nothing is known. */
export const paidOverlayContact = (
  contact: { name?: unknown; npub?: unknown } | null | undefined,
): PaidOverlayContact | null => {
  if (!contact) return null;
  const name = String(contact.name ?? "").trim() || null;
  const npub = String(contact.npub ?? "").trim() || null;
  return name === null && npub === null ? null : { name, npub };
};
