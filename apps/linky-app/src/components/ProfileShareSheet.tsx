import { ListRow, Sheet } from "@linky-fit/ui";
import type { IconName } from "@linky-fit/ui";
import type { FC } from "react";
import type { Translate } from "../i18n";
import { isNativePlatform } from "../platform/runtime";

interface ProfileShareSheetProps {
  npub: string;
  onClose: () => void;
  copyText: (text: string) => Promise<void>;
  shareText: (text: string) => Promise<void>;
  shareUrl: string;
  t: Translate;
}

interface ShareAction {
  icon: IconName;
  label: string;
  run: () => Promise<void>;
}

export const ProfileShareSheet: FC<ProfileShareSheetProps> = ({
  npub,
  onClose,
  copyText,
  shareText,
  shareUrl,
  t,
}) => {
  const actions: ShareAction[] = [
    {
      icon: "Copy",
      label: t("copyProfileLink"),
      run: () => copyText(shareUrl),
    },
    { icon: "Copy", label: t("copyNpub"), run: () => copyText(npub) },
  ];
  if (isNativePlatform() || typeof navigator.share === "function")
    actions.push({
      icon: "Share2",
      label: t("share"),
      run: () => shareText(shareUrl),
    });

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("shareProfile")}
    >
      {actions.map((action) => (
        <ListRow
          key={action.label}
          testID="profile-share-action"
          icon={action.icon}
          title={action.label}
          chevron={false}
          onPress={() => {
            onClose();
            void action.run();
          }}
        />
      ))}
    </Sheet>
  );
};
