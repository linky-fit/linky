import type { TokenTransfer } from "@linky/linkshu";
import { useAppShellCore } from "../app/context/AppShellContexts";
import type { LocalNostrMessage } from "../app/types/appTypes";
import type { ContactId } from "../evolu";
import { navigateTo } from "../hooks/useRouting";

export interface CashuTokenHandoffProps {
  transfer: TokenTransfer;
  chats: readonly LocalNostrMessage[];
  contacts: readonly { id: ContactId; name?: string | null }[];
}

export const CashuTokenHandoff = ({
  transfer,
  chats,
  contacts,
}: CashuTokenHandoffProps) => {
  const { t } = useAppShellCore();
  const location =
    transfer.status === "externalized"
      ? "cashuHandoffNfc"
      : transfer.kind === "receive"
        ? "cashuHandoffReceived"
        : transfer.status === "issued"
          ? "cashuHandoffIssued"
          : transfer.status === "returned"
            ? "cashuHandoffReclaimed"
            : "cashuHandoffUnknown";
  return (
    <div className="cashu-transfer-location">
      {chats.length === 0
        ? t(location)
        : chats.map((message) => (
            <button
              type="button"
              key={message.contactId}
              className="cashu-transfer-chat"
              onClick={() =>
                navigateTo({ route: "chat", id: message.contactId })
              }
            >
              {t(
                message.direction === "in"
                  ? "cashuReceivedInChat"
                  : message.status === "pending"
                    ? "cashuQueuedInChat"
                    : "cashuSentInChat",
              )}
              {" · "}
              {contacts.find((contact) => contact.id === message.contactId)
                ?.name || t("cashuChatContact")}
            </button>
          ))}
      {chats.length > 0 && transfer.status === "externalized" ? (
        <span>{t("cashuHandoffNfc")}</span>
      ) : null}
    </div>
  );
};
