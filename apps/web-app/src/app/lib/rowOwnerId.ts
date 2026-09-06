import { readField } from "../../utils/unknown";

export const readRowOwnerId = (row: unknown): string => {
  const ownerId = readField(row, "ownerId");
  return typeof ownerId === "string" ? ownerId.trim() : "";
};
