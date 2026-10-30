import { siteConfig } from "./config";
import type { ContactMessage } from "./contactMessage";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** Hands the contact form to the site's function; true once a relay accepted the message. */
export const sendContactMessage = async (
  contact: ContactMessage,
): Promise<boolean> => {
  try {
    const response = await fetch(siteConfig.contactUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(contact),
    });
    if (!response.ok) return false;
    const body: unknown = await response.json();
    return isRecord(body) && body.status === "OK";
  } catch {
    return false;
  }
};
