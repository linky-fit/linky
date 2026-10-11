import type { TokenTransfer } from "@linky-fit/linkshu";
import { Button, Stack, Text } from "@linky-fit/ui";
import { useTranslation } from "../app/hooks/shell";
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
  const { t } = useTranslation();
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
  const chatLabel = (message: LocalNostrMessage) =>
    `${t(
      message.direction === "in"
        ? "cashuReceivedInChat"
        : message.status === "pending"
          ? "cashuQueuedInChat"
          : "cashuSentInChat",
    )} · ${
      contacts.find((contact) => contact.id === message.contactId)?.name ||
      t("cashuChatContact")
    }`;
  return (
    <Stack alignItems="flex-start" gap="$xs">
      {chats.length === 0 ? (
        <Text>{t(location)}</Text>
      ) : (
        chats.map((message) => (
          <Button
            key={message.contactId}
            variant="ghost"
            size="sm"
            icon="MessageCircle"
            onPress={() => navigateTo({ route: "chat", id: message.contactId })}
          >
            {chatLabel(message)}
          </Button>
        ))
      )}
      {chats.length > 0 && transfer.status === "externalized" ? (
        <Text>{t("cashuHandoffNfc")}</Text>
      ) : null}
    </Stack>
  );
};
