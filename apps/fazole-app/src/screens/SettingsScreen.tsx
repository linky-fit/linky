import {
  Avatar,
  Button,
  Card,
  Dialog,
  ListRow,
  Section,
  StatusDot,
  Switch,
} from "@linky-fit/ui";
import { useState } from "react";
import { copy } from "../copy";
import { formatCzechIban, type ShopProfile } from "../domain";
import { navigateTo } from "../platform/hashRoute";
import {
  language,
  LANGUAGE_NAMES,
  LANGUAGES,
  switchLanguage,
} from "../platform/language";
import {
  useAppServices,
  useDevice,
  useLightningOnlyQr,
  useOfferTips,
  useSupportChat,
} from "../services/react";
import { ConfirmDialog } from "./ConfirmDialog";
import { Page } from "./Page";
import { RecoverySeed } from "./RecoverySeed";
import { ShopFields } from "./ShopFields";
import { ShopPictureDialog } from "./ShopPictureDialog";
import { useShopForm } from "./shopForm";

type OpenDialog =
  | "shop"
  | "picture"
  | "seed"
  | "restore"
  | "reset"
  | "language";

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

export function SettingsScreen({ shop }: { readonly shop: ShopProfile }) {
  const device = useDevice();
  const { config, saveOfferTips, saveLightningOnlyQr } = useAppServices();
  const offerTips = useOfferTips() ?? true;
  const lightningOnlyQr = useLightningOnlyQr() ?? false;
  const supportUnread = useSupportChat()?.unread ?? false;
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const close = () => setDialog(null);

  return (
    <Page title={copy.sections.settings} testID="settings-screen">
      <Section title={copy.settings.shop}>
        <Card paddingVertical="$sm" gap="$none">
          <ListRow
            testID="settings-shop"
            leading={
              <Avatar
                name={shop.name}
                uri={shop.picture ?? undefined}
                icon="Store"
                size="sm"
              />
            }
            title={shop.name}
            description={
              shop.iban === null
                ? copy.settings.noAccount
                : formatCzechIban(shop.iban)
            }
            onPress={() => setDialog("shop")}
          />
          <ListRow
            testID="settings-picture"
            icon="ImageUp"
            title={copy.shopPicture.title}
            description={
              shop.picture === null ? copy.shopPicture.none : undefined
            }
            onPress={() => setDialog("picture")}
          />
          <ListRow
            testID="settings-tips"
            icon="HandCoins"
            title={copy.settings.offerTips}
            description={copy.settings.offerTipsDescription}
            chevron={false}
            trailing={
              <Switch
                accessibilityLabel={copy.settings.offerTips}
                value={offerTips}
                onValueChange={(offer) => void saveOfferTips(offer)}
              />
            }
          />
          <ListRow
            testID="settings-lightning-only-qr"
            icon="Zap"
            title={copy.settings.lightningOnlyQr}
            description={copy.settings.lightningOnlyQrDescription}
            chevron={false}
            trailing={
              <Switch
                accessibilityLabel={copy.settings.lightningOnlyQr}
                value={lightningOnlyQr}
                onValueChange={(only) => void saveLightningOnlyQr(only)}
              />
            }
          />
        </Card>
      </Section>
      <Section title={copy.settings.security}>
        <Card paddingVertical="$sm" gap="$none">
          <ListRow
            testID="settings-seed"
            icon="KeyRound"
            title={copy.settings.recoverySeed}
            onPress={() => setDialog("seed")}
          />
          <ListRow
            testID="settings-restore"
            icon="RefreshCcw"
            title={copy.settings.restore}
            onPress={() => setDialog("restore")}
          />
          <ListRow
            testID="settings-reset"
            icon="Trash2"
            title={copy.settings.reset}
            destructive
            onPress={() => setDialog("reset")}
          />
        </Card>
      </Section>
      <Section title={copy.settings.help}>
        <Card paddingVertical="$sm" gap="$none">
          <ListRow
            testID="settings-support"
            icon="MessageCircle"
            title={copy.settings.contactSupport}
            trailing={
              supportUnread ? (
                <StatusDot
                  tone="accent"
                  accessibilityLabel={copy.settings.unreadSupport}
                />
              ) : undefined
            }
            onPress={() => navigateTo("support")}
          />
        </Card>
      </Section>
      <Section title={copy.settings.about}>
        <Card paddingVertical="$sm" gap="$none">
          <ListRow
            testID="settings-language"
            icon="Languages"
            title={copy.settings.language}
            value={LANGUAGE_NAMES[language]}
            onPress={() => setDialog("language")}
          />
          <ListRow
            icon="Bitcoin"
            title={copy.settings.mint}
            value={hostOf(config.mintUrl)}
          />
        </Card>
      </Section>

      {dialog === "shop" ? (
        <EditShopDialog shop={shop} onClose={close} />
      ) : null}
      {dialog === "picture" ? (
        <ShopPictureDialog shop={shop} onClose={close} />
      ) : null}
      <Dialog
        open={dialog === "seed"}
        onOpenChange={(open) => (open ? undefined : close())}
        title={copy.settings.recoverySeed}
        closeLabel={copy.close}
        testID="seed-dialog"
      >
        <RecoverySeed shopName={shop.name} />
      </Dialog>
      <Dialog
        open={dialog === "language"}
        onOpenChange={(open) => (open ? undefined : close())}
        title={copy.settings.language}
        closeLabel={copy.close}
        testID="language-dialog"
      >
        {LANGUAGES.map((option) => (
          <ListRow
            key={option}
            testID={`language-${option}`}
            title={LANGUAGE_NAMES[option]}
            selected={option === language}
            chevron={false}
            onPress={() =>
              option === language ? close() : void switchLanguage(option)
            }
          />
        ))}
      </Dialog>
      <ConfirmDialog
        open={dialog === "restore"}
        onClose={close}
        title={copy.settings.restoreConfirmTitle}
        description={copy.settings.restoreConfirmDescription}
        confirm={copy.continue}
        destructive
        onConfirm={() => navigateTo("restore")}
      />
      <ConfirmDialog
        open={dialog === "reset"}
        onClose={close}
        title={copy.settings.resetConfirmTitle}
        description={copy.settings.resetConfirmDescription}
        confirm={copy.settings.resetConfirm}
        destructive
        onConfirm={device.resetDevice}
      />
    </Page>
  );
}

function EditShopDialog({
  shop,
  onClose,
}: {
  readonly shop: ShopProfile;
  readonly onClose: () => void;
}) {
  const services = useAppServices();
  const form = useShopForm(shop);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    const edited = form.submit();
    if (edited === null) return;
    setSaving(true);
    try {
      await services.shop.save(edited);
      onClose();
    } catch (error) {
      console.warn("[fazole] shop not saved", error);
      setSaving(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={copy.settings.shopEdit}
      closeLabel={copy.close}
      testID="shop-dialog"
      actions={
        <Button testID="shop-save" loading={saving} onPress={() => void save()}>
          {copy.save}
        </Button>
      }
    >
      <ShopFields form={form} />
    </Dialog>
  );
}
