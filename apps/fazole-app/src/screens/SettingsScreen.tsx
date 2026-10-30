import {
  Avatar,
  Button,
  Card,
  Dialog,
  ListRow,
  Section,
  size,
  Stack,
  StatusDot,
  Switch,
  Text,
} from "@linky-fit/ui";
import { useState } from "react";
import { copy } from "../copy";
import { formatCzechIban, isMonetaIban, type ShopProfile } from "../domain";
import { navigateTo } from "../platform/hashRoute";
import { language, LANGUAGE_NAMES } from "../platform/language";
import {
  useAppServices,
  useBitcoinQrMode,
  useDevice,
  useMonetaConnection,
  useOfferTips,
  useSupportChat,
} from "../services/react";
import { BITCOIN_QR_MODES } from "../storage/bitcoinQrSetting";
import { ConfirmDialog } from "./ConfirmDialog";
import { LanguageDialog } from "./LanguageDialog";
import { MonetaDialog } from "./MonetaDialog";
import { Page } from "./Page";
import { RecoverySeed } from "./RecoverySeed";
import { ShopFields } from "./ShopFields";
import { ShopPictureDialog } from "./ShopPictureDialog";
import { useShopForm } from "./shopForm";

type OpenDialog =
  | "shop"
  | "moneta"
  | "bitcoinQr"
  | "seed"
  | "reset"
  | "language";

const versionLabel = __APP_COMMIT_SHA__
  ? `${__APP_VERSION__} (${__APP_COMMIT_SHA__})`
  : __APP_VERSION__;

/** The shop's picture or store icon, centered on a row's icon slot so the title lines up with the other rows. */
function ShopAvatar({ shop }: { readonly shop: ShopProfile }) {
  return (
    <Stack width={size.iconSm} alignItems="center">
      <Avatar
        name={shop.name ?? ""}
        uri={shop.picture ?? undefined}
        icon="Store"
        size="sm"
      />
    </Stack>
  );
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

export function SettingsScreen({ shop }: { readonly shop: ShopProfile }) {
  const device = useDevice();
  const { config, saveOfferTips, saveBitcoinQrMode } = useAppServices();
  const offerTips = useOfferTips() ?? true;
  const bitcoinQrMode = useBitcoinQrMode() ?? "universal";
  const supportUnread = useSupportChat()?.unread ?? false;
  const connection = useMonetaConnection() ?? null;
  // The bank confirms payments only for a MONETA account; a token for another account no longer counts.
  const monetaAccount = shop.iban !== null && isMonetaIban(shop.iban);
  const monetaConnected = connection !== null && connection.iban === shop.iban;
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const close = () => setDialog(null);

  return (
    <Page title={copy.sections.settings} testID="settings-screen">
      <Section title={copy.settings.shop}>
        <Card paddingVertical="$sm" gap="$none">
          <ListRow
            testID="settings-shop"
            leading={<ShopAvatar shop={shop} />}
            title={shop.name ?? copy.settings.shopUnnamed}
            description={
              shop.iban === null ? undefined : formatCzechIban(shop.iban)
            }
            onPress={() => setDialog("shop")}
          />
          {monetaAccount ? (
            <ListRow
              testID="settings-moneta"
              icon="ShieldCheck"
              title={copy.settings.moneta}
              value={
                monetaConnected
                  ? copy.settings.monetaOn
                  : copy.settings.monetaOff
              }
              onPress={() => setDialog("moneta")}
            />
          ) : null}
          <ListRow
            testID="settings-tips"
            icon="HandCoins"
            title={copy.settings.offerTips}
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
            testID="settings-bitcoin-qr"
            icon="QrCode"
            title={copy.settings.bitcoinQr}
            value={copy.settings.bitcoinQrModes[bitcoinQrMode]}
            onPress={() => setDialog("bitcoinQr")}
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
      <Section title={copy.settings.security}>
        <Card paddingVertical="$sm" gap="$none">
          <ListRow
            testID="settings-seed"
            icon="KeyRound"
            title={copy.settings.recoverySeed}
            onPress={() => setDialog("seed")}
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
      <Text
        testID="settings-version"
        variant="caption"
        color="$colorMuted"
        textAlign="center"
      >
        {versionLabel}
      </Text>

      {dialog === "shop" ? (
        <EditShopDialog
          shop={shop}
          onClose={close}
          onSaved={(edited) => {
            // A MONETA account just entered is offered the bank's confirmation right away.
            setDialog(
              edited.iban !== null &&
                isMonetaIban(edited.iban) &&
                connection?.iban !== edited.iban
                ? "moneta"
                : null,
            );
          }}
        />
      ) : null}
      {dialog === "moneta" ? (
        <MonetaDialog
          shop={shop}
          connection={monetaConnected ? connection : null}
          onClose={close}
        />
      ) : null}
      <Dialog
        open={dialog === "bitcoinQr"}
        onOpenChange={(open) => (open ? undefined : close())}
        title={copy.settings.bitcoinQr}
        closeLabel={copy.close}
        testID="bitcoin-qr-dialog"
      >
        {BITCOIN_QR_MODES.map((mode) => (
          <ListRow
            key={mode}
            testID={`bitcoin-qr-${mode}`}
            title={copy.settings.bitcoinQrModes[mode]}
            selected={mode === bitcoinQrMode}
            chevron={false}
            onPress={() => {
              void saveBitcoinQrMode(mode);
              close();
            }}
          />
        ))}
      </Dialog>
      <Dialog
        open={dialog === "seed"}
        onOpenChange={(open) => (open ? undefined : close())}
        title={copy.settings.recoverySeed}
        closeLabel={copy.close}
        testID="seed-dialog"
      >
        <RecoverySeed shopName={shop.name} />
      </Dialog>
      <LanguageDialog open={dialog === "language"} onClose={close} />
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

/** The shop's details, with its picture managed one step deeper; the form survives that step. */
function EditShopDialog({
  shop,
  onClose,
  onSaved,
}: {
  readonly shop: ShopProfile;
  readonly onClose: () => void;
  readonly onSaved: (shop: ShopProfile) => void;
}) {
  const services = useAppServices();
  const form = useShopForm(shop);
  const [saving, setSaving] = useState(false);
  const [editingPicture, setEditingPicture] = useState(false);
  const save = async () => {
    const edited = form.submit();
    if (edited === null) return;
    setSaving(true);
    try {
      await services.shop.save(edited);
      onSaved(edited);
    } catch (error) {
      console.warn("[fazole] shop not saved", error);
      setSaving(false);
    }
  };
  if (editingPicture) {
    return (
      <ShopPictureDialog shop={shop} onClose={() => setEditingPicture(false)} />
    );
  }
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
      <ListRow
        testID="settings-picture"
        leading={<ShopAvatar shop={shop} />}
        title={copy.shopPicture.title}
        onPress={() => setEditingPicture(true)}
      />
      <ShopFields form={form} />
    </Dialog>
  );
}
