import { Button, EmptyState, Row, Stack, Text } from "@linky-fit/ui";
import React, { useCallback, useMemo, useState } from "react";
import {
  useSeedBackup,
  useSeedMnemonic,
} from "../app/hooks/settings/useIdentitySettings";
import { usePushToast, useTranslation } from "../app/hooks/shell";

export function MasterKeysPage(): React.ReactElement {
  const { copySeed, saveSeedToPasswordManager } = useSeedBackup();
  const seedMnemonic = useSeedMnemonic();
  const pushToast = usePushToast();
  const { t } = useTranslation();
  const [isVisible, setIsVisible] = useState(false);
  const seedWords = useMemo(
    () =>
      (seedMnemonic ?? "")
        .trim()
        .split(/\s+/)
        .filter((word) => word.length > 0),
    [seedMnemonic],
  );
  const hasSeedMnemonic = seedWords.length > 0;

  const handleSaveSeed = useCallback(async () => {
    if (!hasSeedMnemonic) {
      pushToast(t("seedMissing"));
      return;
    }

    const result = await saveSeedToPasswordManager();
    if (result === "failed") {
      pushToast(t("onboardingBackupSaveFailed"));
      return;
    }

    if (result === "unsupported") {
      pushToast(t("onboardingBackupSaveUnavailable"));
      return;
    }

    if (result === "saved") {
      pushToast(t("onboardingBackupSaveRequested"));
    }
  }, [hasSeedMnemonic, pushToast, saveSeedToPasswordManager, t]);

  return (
    <Stack gap="$lg">
      {hasSeedMnemonic ? (
        <Row
          flexWrap="wrap"
          rowGap="$xs"
          columnGap="$lg"
          padding="$lg"
          borderRadius="$card"
          backgroundColor="$surface"
          aria-live="polite"
        >
          {seedWords.map((word, index) => (
            <Row
              key={index}
              flexBasis="40%"
              flexGrow={1}
              paddingVertical="$xs"
              gap="$sm"
            >
              <Text
                variant="caption"
                color="$colorMuted"
                minWidth="$iconLg"
                textAlign="right"
              >
                {index + 1}
              </Text>
              <Text
                mono
                variant="label"
                color={isVisible ? "$colorStrong" : "$colorMuted"}
              >
                {isVisible ? word : "****"}
              </Text>
            </Row>
          ))}
        </Row>
      ) : (
        <EmptyState title={t("seedMissing")} />
      )}
      <Stack gap="$sm">
        <Button
          icon="ShieldCheck"
          onPress={() => void handleSaveSeed()}
          disabled={!hasSeedMnemonic}
        >
          {t("onboardingBackupSave")}
        </Button>
        <Row gap="$sm">
          <Button
            flex={1}
            variant="secondary"
            icon={isVisible ? "EyeOff" : "Eye"}
            onPress={() => setIsVisible((current) => !current)}
            disabled={!hasSeedMnemonic}
          >
            {isVisible ? t("masterKeysHide") : t("masterKeysShow")}
          </Button>
          <Button
            flex={1}
            variant="secondary"
            icon="Copy"
            onPress={copySeed}
            disabled={!hasSeedMnemonic}
            data-guide="copy-seed"
          >
            {t("copy")}
          </Button>
        </Row>
      </Stack>
    </Stack>
  );
}
