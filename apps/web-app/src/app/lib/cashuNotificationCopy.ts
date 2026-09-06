export const getReceivedMoneyCopyForLanguage = (
  language: string | null | undefined,
): string => {
  const normalized = (language ?? "").trim().toLowerCase();
  if (normalized.startsWith("cs")) {
    return "Přijali jste peníze";
  }
  if (normalized.startsWith("de")) {
    return "Du hast Geld erhalten";
  }
  return "You received money";
};

export const getChatAttachmentCopyForLanguage = (
  language: string | null | undefined,
  kind: "image" | "pdf",
): string => {
  const normalized = (language ?? "").trim().toLowerCase();
  if (normalized.startsWith("cs")) {
    return kind === "pdf" ? "PDF" : "Obrázek";
  }
  if (normalized.startsWith("de")) {
    return kind === "pdf" ? "PDF" : "Bild";
  }
  return kind === "pdf" ? "PDF" : "Image";
};

export const getBankPaymentReimbursementCopyForLanguage = (
  language: string | null | undefined,
): string => {
  const normalized = (language ?? "").trim().toLowerCase();
  if (normalized.startsWith("cs")) {
    return "Dorazily ti saty za bankovní platbu";
  }
  if (normalized.startsWith("de")) {
    return "Deine Sats für die Bankzahlung sind angekommen";
  }
  return "Your sats for the bank payment have arrived";
};
