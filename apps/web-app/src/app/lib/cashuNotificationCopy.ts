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
  if (normalized.startsWith("pt")) {
    return "Você recebeu dinheiro";
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
  if (normalized.startsWith("pt")) {
    return kind === "pdf" ? "PDF" : "Imagem";
  }
  return kind === "pdf" ? "PDF" : "Image";
};

export const getRecurringReminderCopyForLanguage = (
  language: string | null | undefined,
): string => {
  const normalized = (language ?? "").trim().toLowerCase();
  if (normalized.startsWith("cs")) {
    return "Pravidelná platba je připravena. Otevřete Linky a odešlete ji.";
  }
  if (normalized.startsWith("de")) {
    return "Eine wiederkehrende Zahlung ist bereit. Öffne Linky, um sie zu senden.";
  }
  return "A recurring payment is ready. Open Linky to send it.";
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
  if (normalized.startsWith("pt")) {
    return "Seus sats pelo pagamento bancário chegaram";
  }
  return "Your sats for the bank payment have arrived";
};
