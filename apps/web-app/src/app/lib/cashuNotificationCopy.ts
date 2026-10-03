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

interface RecurringReminderCopy {
  named: (note: string) => string;
  unnamed: string;
  several: (count: number) => string;
  body: string;
  severalBody: string;
}

const RECURRING_REMINDER_COPY = {
  cs: {
    named: (note) => `Připraveno k odeslání: ${note}`,
    unnamed: "Platba je připravena k odeslání",
    several: (count) =>
      `Připraveno k odeslání: ${count} ${count < 5 ? "platby" : "plateb"}`,
    body: "Otevřete aplikaci a odešlete platbu.",
    severalBody: "Otevřete aplikaci a odešlete platby.",
  },
  de: {
    named: (note) => `Bereit zum Senden: ${note}`,
    unnamed: "Zahlung bereit zum Senden",
    several: (count) => `${count} Zahlungen bereit zum Senden`,
    body: "Öffne die App, um die Zahlung zu senden.",
    severalBody: "Öffne die App, um die Zahlungen zu senden.",
  },
  pt: {
    named: (note) => `Pronto para enviar: ${note}`,
    unnamed: "Pagamento pronto para enviar",
    several: (count) => `${count} pagamentos prontos para enviar`,
    body: "Abra o app para enviar o pagamento.",
    severalBody: "Abra o app para enviar os pagamentos.",
  },
  en: {
    named: (note) => `Ready to send ${note}`,
    unnamed: "Ready to send payment",
    several: (count) => `Ready to send ${count} payments`,
    body: "Open the app to send the payment.",
    severalBody: "Open the app to send the payments.",
  },
} satisfies Record<string, RecurringReminderCopy>;

const reminderCopyFor = (
  language: string | null | undefined,
): RecurringReminderCopy => {
  const normalized = (language ?? "").trim().toLowerCase();
  if (normalized.startsWith("cs")) return RECURRING_REMINDER_COPY.cs;
  if (normalized.startsWith("de")) return RECURRING_REMINDER_COPY.de;
  if (normalized.startsWith("pt")) return RECURRING_REMINDER_COPY.pt;
  return RECURRING_REMINDER_COPY.en;
};

/** The nudge for the payments due at one reminder time, named by their notes when this device stored them. */
export const getRecurringReminderCopyForLanguage = (
  language: string | null | undefined,
  notes: ReadonlyArray<string | null> | null,
): { title: string; body: string } => {
  const copy = reminderCopyFor(language);
  const count = notes?.length ?? 0;
  if (count > 1) return { title: copy.several(count), body: copy.severalBody };
  const note = notes?.[0];
  return { title: note ? copy.named(note) : copy.unnamed, body: copy.body };
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
