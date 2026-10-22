import type { OnchainTransferUpdate } from "@linky-fit/onchain-transfer";
import { formatInteger } from "../../utils/formatting";

interface OnchainTransferPushCopy {
  readyToSend: string;
  readyToReceive: string;
  completed: string;
  denied: string;
  refunded: string;
  updated: string;
}

const COPY = {
  cs: {
    readyToSend:
      "Připraveno: zaplaťte {total} a do vaší bitcoinové peněženky odešleme {amount}.",
    readyToReceive: "Připraveno: pošlete {total} ze své bitcoinové peněženky.",
    completed: "Vaše on-chain transakce je dokončená",
    denied: "Vaše on-chain transakce byla zamítnuta",
    refunded: "Peníze z vaší on-chain transakce byly vráceny",
    updated: "Vaše on-chain transakce byla aktualizována",
  },
  de: {
    readyToSend:
      "Bereit: Zahle {total}, um {amount} an deine Bitcoin-Wallet zu senden.",
    readyToReceive: "Bereit: Sende {total} von deiner Bitcoin-Wallet.",
    completed: "Deine On-Chain-Transaktion ist abgeschlossen",
    denied: "Deine On-Chain-Transaktion wurde abgelehnt",
    refunded: "Deine On-Chain-Transaktion wurde erstattet",
    updated: "Deine On-Chain-Transaktion wurde aktualisiert",
  },
  pt: {
    readyToSend:
      "Pronto: pague {total} para enviar {amount} para sua carteira bitcoin.",
    readyToReceive: "Pronto: envie {total} da sua carteira bitcoin.",
    completed: "Sua transação on-chain foi concluída",
    denied: "Sua transação on-chain foi recusada",
    refunded: "Sua transação on-chain foi reembolsada",
    updated: "Sua transação on-chain foi atualizada",
  },
  en: {
    readyToSend: "Ready: pay {total} to send {amount} to your bitcoin wallet.",
    readyToReceive: "Ready: send {total} from your bitcoin wallet.",
    completed: "Your on-chain transaction is complete",
    denied: "Your on-chain transaction was declined",
    refunded: "Your on-chain transaction was refunded",
    updated: "Your on-chain transaction was updated",
  },
} satisfies Record<string, OnchainTransferPushCopy>;

const copyFor = (language: string | null | undefined) => {
  const normalized = (language ?? "").trim().toLowerCase();
  if (normalized.startsWith("cs")) return COPY.cs;
  if (normalized.startsWith("de")) return COPY.de;
  if (normalized.startsWith("pt")) return COPY.pt;
  return COPY.en;
};

/**
 * The body of a push for an update of the on-chain operator, which the service
 * worker shows while the app is closed. The update alone does not say the
 * direction except once accepted, by the deposit address or the payment request;
 * the ready copy tells what to pay or send apart from what arrives.
 */
export const getOnchainTransferUpdateCopyForLanguage = (
  language: string | null | undefined,
  update: OnchainTransferUpdate,
): string => {
  const copy = copyFor(language);
  const sats = (amount: number) =>
    `${formatInteger(amount, language ?? undefined)} sat`;
  switch (update.status) {
    case "accepted":
      return (
        update.depositAddress === undefined
          ? copy.readyToSend
          : copy.readyToReceive
      )
        .replace("{total}", sats(update.sendAmount))
        .replace("{amount}", sats(update.sendAmount - update.fee));
    case "completed":
    case "denied":
    case "refunded":
      return copy[update.status];
    default:
      return copy.updated;
  }
};
