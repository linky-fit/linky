import { ListRow, Sheet, Text, TextField } from "@linky-fit/ui";
import type { IconName } from "@linky-fit/ui";
import React from "react";
import type { Translate } from "../i18n";

interface ShareOptionsModalProps {
  onClose: () => void;
  onCopy: () => void;
  onEmail: () => void;
  onSms: () => void;
  onWhatsApp: () => void;
  shareText: string;
  t: Translate;
}

export function ShareOptionsModal({
  onClose,
  onCopy,
  onEmail,
  onSms,
  onWhatsApp,
  shareText,
  t,
}: ShareOptionsModalProps): React.ReactElement {
  const shareActions: { icon: IconName; label: string; onPress: () => void }[] =
    [
      {
        icon: "MessageCircle",
        label: t("shareViaWhatsApp"),
        onPress: onWhatsApp,
      },
      { icon: "MessageCircleMore", label: t("shareViaSms"), onPress: onSms },
      { icon: "Send", label: t("shareViaEmail"), onPress: onEmail },
      { icon: "Copy", label: t("copy"), onPress: onCopy },
    ];

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("shareOptionsTitle")}
    >
      <Text color="$colorMuted">{t("shareOptionsBody")}</Text>
      <TextField
        multiline
        label={t("shareOptionsPreviewLabel")}
        hideLabel
        readOnly
        value={shareText}
      />
      {shareActions.map((action) => (
        <ListRow
          key={action.label}
          icon={action.icon}
          title={action.label}
          chevron={false}
          onPress={action.onPress}
        />
      ))}
    </Sheet>
  );
}
