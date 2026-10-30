/**
 * What the contact form sends, and what the site's function forwards: how to
 * reach the sender, an email or a phone, and what they wrote. The contact is
 * the point of the form, so one of the two is required.
 */
export interface ContactMessage {
  readonly email?: string;
  readonly phone?: string;
  readonly message?: string;
  /** A honeypot the form never shows, so only a bot fills it. */
  readonly website?: string;
}

const limits = { email: 254, phone: 40, message: 4000, website: 500 } as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const isEmail = (value: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value);

type Field = keyof typeof limits;

/** The field trimmed, `undefined` when left out or empty, `null` when it is not a text within its limit. */
const text = (
  body: Record<string, unknown>,
  field: Field,
): string | undefined | null => {
  const value = body[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > limits[field]) return null;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
};

/** Reads a contact message out of a request body; `null` when it is not one. */
export const parseContactMessage = (value: unknown): ContactMessage | null => {
  if (!isRecord(value)) return null;
  const email = text(value, "email");
  const phone = text(value, "phone");
  const message = text(value, "message");
  const website = text(value, "website");
  if (
    email === null ||
    phone === null ||
    message === null ||
    website === null
  ) {
    return null;
  }
  if (email !== undefined && !isEmail(email)) return null;
  if (phone !== undefined && phone.length < 3) return null;
  if (email === undefined && phone === undefined) return null;
  return {
    ...(email === undefined ? {} : { email }),
    ...(phone === undefined ? {} : { phone }),
    ...(message === undefined ? {} : { message }),
    ...(website === undefined ? {} : { website }),
  };
};

const line = (label: string, value: string | undefined): string[] =>
  value === undefined ? [] : [`${label}: ${value}`];

/** The message as one chat message: how to reach the sender first, what they wrote below. */
export const formatContactMessage = (contact: ContactMessage): string =>
  [
    ...line("Email", contact.email),
    ...line("Phone", contact.phone),
    ...(contact.message === undefined ? [] : ["", contact.message]),
  ].join("\n");

/** The chat's name in a Nostr client: the site and who wrote. */
export const contactMessageSubject = (contact: ContactMessage): string =>
  `fazole.fit: ${contact.email ?? contact.phone ?? ""}`;
