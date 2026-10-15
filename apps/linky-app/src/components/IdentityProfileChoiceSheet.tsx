import {
  Avatar,
  Button,
  Card,
  Icon,
  Row,
  SegmentedControl,
  Sheet,
  Spinner,
  Stack,
  Text,
} from "@linky-fit/ui";
import React from "react";
import type { PendingIdentitySwitch } from "../app/hooks/useProfileAuthDomain";
import {
  profileForIdentitySwitch,
  type IdentityProfileSource,
} from "../app/lib/keySwitchProfile";
import type { Translate } from "../i18n";
import { getProfilePictureUrl } from "../profileCache";
import { formatShortNpub, getBestNostrName } from "../utils/formatting";

interface IdentityProfileChoiceSheetProps {
  onAnswer: (source: IdentityProfileSource | null) => Promise<void>;
  pending: PendingIdentitySwitch;
  t: Translate;
}

/**
 * Lets the user pick, before a custom identity switch, whether the identity
 * publishes the Linky profile or keeps its own Nostr profile, previewing
 * exactly the profile that will be published. It opens while Linky still
 * checks the identity; without a known Nostr profile only the Linky profile
 * is offered.
 */
export function IdentityProfileChoiceSheet({
  onAnswer,
  pending,
  t,
}: IdentityProfileChoiceSheetProps): React.ReactElement {
  const [isConfirming, setIsConfirming] = React.useState(false);
  const isBusy = isConfirming || pending.phase === "switching";

  const confirm = async (source: IdentityProfileSource) => {
    setIsConfirming(true);
    try {
      await onAnswer(source);
    } finally {
      setIsConfirming(false);
    }
  };

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !isBusy) void onAnswer(null);
      }}
      title={t("identityProfileChoiceTitle")}
    >
      <Stack gap="$lg" testID="identity-profile-choice">
        {pending.phase === "choosing" ? (
          <ProfileChoice
            isConfirming={isConfirming}
            onConfirm={(source) => void confirm(source)}
            pending={pending}
            t={t}
          />
        ) : (
          <Row alignItems="center" gap="$sm" paddingVertical="$lg">
            <Spinner />
            <Text variant="body" color="$colorSubtle" flex={1}>
              {t(
                pending.phase === "checking"
                  ? "identityProfileChecking"
                  : "identityProfileSwitching",
              )}
            </Text>
          </Row>
        )}
        <Button
          variant="secondary"
          disabled={isBusy}
          onPress={() => void onAnswer(null)}
        >
          {t("identityProfileCancel")}
        </Button>
      </Stack>
    </Sheet>
  );
}

function ProfileChoice({
  isConfirming,
  onConfirm,
  pending,
  t,
}: {
  isConfirming: boolean;
  onConfirm: (source: IdentityProfileSource) => void;
  pending: Extract<PendingIdentitySwitch, { phase: "choosing" }>;
  t: Translate;
}): React.ReactElement {
  const [source, setSource] = React.useState<IdentityProfileSource>("linky");
  const nostrProfile =
    pending.check.kind === "found" ? pending.check.metadata : null;
  const preview = profileForIdentitySwitch({
    lightningAddress: pending.lightningAddress,
    linkyProfile: pending.linkyProfile,
    nostrProfile,
    source,
  });
  const shortNpub = formatShortNpub(pending.npub);
  const name = getBestNostrName(preview) ?? shortNpub;

  return (
    <>
      <Text variant="body" color="$colorSubtle">
        {t(
          nostrProfile
            ? "identityProfileChoiceFound"
            : "identityProfileChoiceUnchecked",
        )}
      </Text>
      {nostrProfile ? (
        <SegmentedControl
          accessibilityLabel={t("identityProfileChoiceTitle")}
          value={source}
          onValueChange={setSource}
          options={[
            { value: "linky", label: t("identityProfileUseLinky") },
            { value: "nostr", label: t("identityProfileUseNostr") },
          ]}
        />
      ) : null}
      <Card outlined gap="$md" padding="$md" testID="identity-profile-preview">
        <Row>
          <Avatar
            name={name}
            size="lg"
            uri={getProfilePictureUrl(preview) ?? undefined}
          />
          <Stack flex={1} minWidth={0} gap="$xs">
            <Text variant="heading" numberOfLines={1}>
              {name}
            </Text>
            <Text variant="caption" mono color="$colorMuted" numberOfLines={1}>
              {shortNpub}
            </Text>
          </Stack>
        </Row>
        {preview.about ? <Text variant="body">{preview.about}</Text> : null}
        <Row alignItems="center" gap="$sm">
          <Icon name="Zap" size="sm" color="$colorMuted" />
          <Text variant="caption" flex={1} numberOfLines={1}>
            {preview.lud16}
          </Text>
        </Row>
        <Row alignItems="center" gap="$sm">
          <Icon name="ShieldCheck" size="sm" color="$colorMuted" />
          <Text
            variant="caption"
            flex={1}
            numberOfLines={1}
            color={preview.nip05 ? "$color" : "$colorMuted"}
          >
            {preview.nip05 ?? t("identityProfileNoHandle")}
          </Text>
        </Row>
      </Card>
      <Text variant="caption" color="$colorMuted">
        {t("identityProfileAddressNote")}
      </Text>
      <Button loading={isConfirming} onPress={() => onConfirm(source)}>
        {t("identityProfileConfirm")}
      </Button>
    </>
  );
}
