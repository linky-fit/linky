/** Display text of a thrown value; `Error`s keep their `Name: message` form. */
export const errorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error) return String(error) || fallback;
  if (typeof error === "string") return error || fallback;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message || fallback;
  }
  return fallback;
};
