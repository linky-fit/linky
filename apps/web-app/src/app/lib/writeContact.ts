import type { OwnerId } from "@evolu/common";

export const writeContact = <Payload, Result extends { readonly ok: boolean }>(
  mutation: (
    table: "contact",
    payload: Payload,
    options?: { ownerId: OwnerId },
  ) => Result,
  payload: Payload,
  ownerId: OwnerId | null,
): Result & { ownerId: OwnerId | null } => {
  if (ownerId) {
    const scoped = mutation("contact", payload, { ownerId });
    if (scoped.ok) return { ...scoped, ownerId };
  }
  return { ...mutation("contact", payload), ownerId: null };
};
