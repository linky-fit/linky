/** The unsigned login event a signer is asked to sign. */
export interface LinkauthTemplate {
  kind: number;
  tags: string[][];
  content: string;
}

/**
 * The signed login event. A plain JSON-serializable Nostr event: store it,
 * send it to your server, or pass it between pages as JSON.
 */
export interface LinkauthAssertion extends LinkauthTemplate {
  id: string;
  pubkey: string;
  created_at: number;
  sig: string;
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isTags = (value: unknown): value is string[][] =>
  Array.isArray(value) &&
  value.every(
    (tag) =>
      Array.isArray(tag) && tag.every((item) => typeof item === "string"),
  );

/** Shape check only: the signature and the template are not verified. */
export const isLinkauthAssertion = (
  value: unknown,
): value is LinkauthAssertion =>
  isRecord(value) &&
  typeof value.id === "string" &&
  /^[0-9a-f]{64}$/.test(value.id) &&
  typeof value.pubkey === "string" &&
  /^[0-9a-f]{64}$/.test(value.pubkey) &&
  typeof value.sig === "string" &&
  /^[0-9a-f]{128}$/.test(value.sig) &&
  Number.isInteger(value.created_at) &&
  Number.isInteger(value.kind) &&
  typeof value.content === "string" &&
  isTags(value.tags);
