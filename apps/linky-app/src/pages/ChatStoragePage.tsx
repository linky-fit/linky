import { Button, ListRow, Notice, Stack, Text } from "@linky-fit/ui";
import { useState } from "react";
import { keepNewest, linkyScopes, messageScopes } from "@linky-fit/linksync";
import { usePushToast, useTranslation } from "../app/hooks/shell";
import { useLinkyStore, useShardSummaries } from "../app/hooks/useLinksync";
import { forgetChatShards } from "../evolu";
import { useArmedAction } from "../hooks/useArmedAction";

const rowValue = (value: React.ReactNode) => (
  <Text variant="label" color="$colorMuted">
    {value}
  </Text>
);

export function ChatStoragePage(): React.ReactElement {
  const { t } = useTranslation();
  const pushToast = usePushToast();
  const summaries = useShardSummaries();
  const store = useLinkyStore();
  const messages = summaries.find((shard) => shard.scope === "messages");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const forgetAction = useArmedAction(() =>
    pushToast(t("sensitiveActionArmedHint")),
  );
  const keep = keepNewest(linkyScopes.messages);
  const subscribed = messages?.visibleOwnerIds.length ?? 0;
  const forgettable = summaries.some(
    (shard) =>
      messageScopes.some((scope) => scope === shard.scope) &&
      shard.visibleOwnerIds.length > keepNewest(linkyScopes[shard.scope]),
  );
  const forget = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await forgetChatShards(store);
      pushToast(t("chatStorageForgotten"));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Stack>
      <Text>{t("chatStoragePolicy").replace("{count}", String(keep))}</Text>
      <ListRow
        testID="chat-storage-total"
        title={t("chatStorageTotal")}
        trailing={rowValue(messages ? messages.index + 1 : t("unknown"))}
      />
      <ListRow
        testID="chat-storage-subscribed"
        title={t("chatStorageSubscribed")}
        trailing={rowValue(messages ? subscribed : t("unknown"))}
      />
      <Text color="$colorMuted">{t("chatStorageForgetHint")}</Text>
      <Button
        variant={forgetAction.armed ? "danger" : "secondary"}
        loading={busy}
        disabled={!forgettable}
        onPress={() => forgetAction.confirm(() => void forget())}
      >
        {t("chatStorageForget")}
      </Button>
      {failed ? <Notice tone="danger" title={t("chatStorageFailed")} /> : null}
    </Stack>
  );
}
