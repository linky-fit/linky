import { useAtomValue, useLinkstrCommands } from "@linky-fit/linkstr-react";
import { Avatar, Button, Card, Pill, Row, Stack, Text } from "@linky-fit/ui";
import React from "react";
import { useEffectiveProfile } from "../app/hooks/profile/useEffectiveProfile";
import {
  useCopyNostrKeys,
  useIdentitySettings,
} from "../app/hooks/settings/useIdentitySettings";
import { useCopyText, usePushToast, useTranslation } from "../app/hooks/shell";
import { fetchAndCacheProfile } from "../app/hooks/useLinkstrProfileSync";
import { currentNpubAtom, currentNsecAtom } from "../app/state/session/session";
import { getContactPublicProfile } from "../app/lib/contactProfile";
import { IdentityProfileChoiceSheet } from "../components/IdentityProfileChoiceSheet";
import { deriveDefaultProfile } from "../derivedProfile";
import { useArmedAction } from "../hooks/useArmedAction";
import { getProfilePictureUrl, loadCachedProfile } from "../profileCache";
import {
  formatShortLightningAddress,
  formatShortNpub,
  getBestNostrName,
} from "../utils/formatting";

interface IdentityPreview {
  lnAddress: string;
  name: string;
  npub: string;
  pictureUrl: string | null;
}

/** Avatar, name, the lightning address and npub (each copies itself when tapped) and the identity's actions under them. */
const IdentityHeader = ({
  actions,
  lnAddress,
  name,
  npub,
  pictureUrl,
}: IdentityPreview & { actions?: React.ReactNode }) => {
  const copyText = useCopyText();
  const { t } = useTranslation();
  return (
    <Row gap="$md" alignItems="flex-start">
      <Avatar name={name} size="lg" uri={pictureUrl ?? undefined} />
      <Stack flex={1} minWidth={0} gap="$xs" alignItems="flex-start">
        <Text variant="heading" numberOfLines={1}>
          {name}
        </Text>
        {lnAddress ? (
          <Button
            variant="ghost"
            size="sm"
            icon="Copy"
            onPress={() => void copyText(lnAddress)}
            aria-label={t("lightningAddress")}
          >
            {formatShortLightningAddress(lnAddress)}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          icon="Copy"
          onPress={() => void copyText(npub)}
          aria-label={`${t("copy")} ${t("npub")}`}
        >
          {formatShortNpub(npub)}
        </Button>
        {actions}
      </Stack>
    </Row>
  );
};

/**
 * An identity that is not in use: what relays hold for it, else what the
 * device cached, else the Linky defaults it would start with.
 */
const useIdentityPreview = (npub: string | null): IdentityPreview | null => {
  const { lang } = useTranslation();
  const { fetchProfile } = useLinkstrCommands();
  const [fetched, setFetched] = React.useState<{
    lnAddress: string;
    name: string | null;
    npub: string;
    pictureUrl: string | null;
  } | null>(null);

  React.useEffect(() => {
    if (!npub) return;
    let cancelled = false;
    void fetchAndCacheProfile(fetchProfile, npub).then((metadata) => {
      if (cancelled || !metadata) return;
      setFetched({
        lnAddress: getContactPublicProfile(npub, metadata).lnAddress,
        name: getBestNostrName(metadata),
        npub,
        pictureUrl: getProfilePictureUrl(metadata),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [fetchProfile, npub]);

  return React.useMemo(() => {
    if (!npub) return null;
    const defaults = deriveDefaultProfile(npub, lang);
    const cached = loadCachedProfile(npub)?.metadata;
    const known =
      fetched?.npub === npub
        ? fetched
        : cached
          ? {
              lnAddress: getContactPublicProfile(npub, cached).lnAddress,
              name: getBestNostrName(cached),
              pictureUrl: getProfilePictureUrl(cached),
            }
          : null;
    return {
      lnAddress: known?.lnAddress || defaults.lnAddress,
      name: known?.name ?? defaults.name,
      npub,
      pictureUrl: known?.pictureUrl ?? defaults.pictureUrl,
    };
  }, [fetched, lang, npub]);
};

export function NostrIdentityPage(): React.ReactElement {
  const {
    answerPendingIdentitySwitch,
    attachedIdentityNpub,
    canSwitchToDefaultIdentity,
    derivedIdentityNpub,
    nostrIdentitySource,
    pendingIdentitySwitch,
    removeAttachedIdentity,
    requestPasteNostrKeys,
    seedMnemonic,
    switchToAttachedIdentity,
    switchToDefaultIdentity,
  } = useIdentitySettings();
  const copyNostrKeys = useCopyNostrKeys();
  const pushToast = usePushToast();
  const { t } = useTranslation();
  const currentNpub = useAtomValue(currentNpubAtom);
  const currentNsec = useAtomValue(currentNsecAtom);
  const {
    effectiveMyLightningAddress,
    effectiveProfileName,
    effectiveProfilePicture,
  } = useEffectiveProfile();
  const hasSeedMnemonic = (seedMnemonic ?? "").trim().length > 0;
  const hasCurrentNsec = (currentNsec ?? "").trim().length > 0;
  const isCustom = nostrIdentitySource === "custom";
  const nsecAction = useArmedAction(() =>
    pushToast(t("sensitiveActionArmedHint")),
  );
  const derivedAction = useArmedAction(() =>
    pushToast(t("defaultIdentityArmedHint")),
  );
  const removeAction = useArmedAction(() => pushToast(t("deleteArmedHint")));
  const otherNpub = isCustom ? derivedIdentityNpub : attachedIdentityNpub;
  const otherPreview = useIdentityPreview(otherNpub);
  const npub = currentNpub ?? "";

  return (
    <Stack gap="$lg">
      <Text color="$colorSubtle">
        {t(isCustom ? "nostrIdentityUsingCustom" : "nostrIdentityUsingDerived")}
      </Text>

      <Card
        gap="$md"
        padding="$md"
        backgroundColor="$accentSoft"
        testID="nostr-identity-current"
      >
        <Row gap="$sm" alignItems="center">
          <Text variant="label" color="$colorMuted" flex={1}>
            {t(
              isCustom
                ? "nostrIdentityCustomTitle"
                : "nostrIdentityDerivedTitle",
            )}
          </Text>
          <Pill size="sm" tone="accent" label={t("nostrIdentityInUse")} />
        </Row>
        <IdentityHeader
          lnAddress={effectiveMyLightningAddress ?? ""}
          name={effectiveProfileName || formatShortNpub(npub)}
          npub={npub}
          pictureUrl={effectiveProfilePicture}
          actions={
            <Button
              size="sm"
              variant={nsecAction.armed ? "danger" : "ghost"}
              icon="KeyRound"
              testID="copy-nostr-keys"
              onPress={() => nsecAction.confirm(() => void copyNostrKeys())}
              disabled={!hasCurrentNsec}
            >
              {t("copyNsec")}
            </Button>
          }
        />
      </Card>

      <Card gap="$md" padding="$md" testID="nostr-identity-other">
        <Text variant="label" color="$colorMuted">
          {t(
            isCustom ? "nostrIdentityDerivedTitle" : "nostrIdentityCustomTitle",
          )}
        </Text>
        {isCustom && otherPreview ? (
          <IdentityHeader
            {...otherPreview}
            actions={
              <Button
                size="sm"
                variant={derivedAction.armed ? "danger" : "secondary"}
                icon="Repeat"
                testID="switch-to-derived-identity"
                onPress={() =>
                  derivedAction.confirm(() => void switchToDefaultIdentity())
                }
                disabled={!canSwitchToDefaultIdentity}
              >
                {t("switchToDefaultIdentity")}
              </Button>
            }
          />
        ) : otherPreview ? (
          <IdentityHeader
            {...otherPreview}
            actions={
              <Row gap="$sm" flexWrap="wrap">
                <Button
                  size="sm"
                  variant="secondary"
                  icon="Repeat"
                  testID="switch-to-attached-identity"
                  onPress={() => void switchToAttachedIdentity()}
                >
                  {t("nostrIdentitySwitchTo")}
                </Button>
                <Button
                  size="sm"
                  variant={removeAction.armed ? "danger" : "ghost"}
                  icon="Trash2"
                  testID="remove-attached-identity"
                  onPress={() =>
                    removeAction.confirm(() => void removeAttachedIdentity())
                  }
                >
                  {t("nostrIdentityRemove")}
                </Button>
              </Row>
            }
          />
        ) : (
          <>
            <Text variant="caption" color="$colorMuted">
              {t("nostrIdentityCustomHint")}
            </Text>
            <Button
              variant="secondary"
              icon="ClipboardPaste"
              testID="paste-nostr-keys"
              onPress={() => void requestPasteNostrKeys()}
              disabled={!hasCurrentNsec || !hasSeedMnemonic}
            >
              {t("pasteCustomNostrKeys")}
            </Button>
          </>
        )}
      </Card>

      {pendingIdentitySwitch ? (
        <IdentityProfileChoiceSheet
          onAnswer={answerPendingIdentitySwitch}
          pending={pendingIdentitySwitch}
          t={t}
        />
      ) : null}
    </Stack>
  );
}
