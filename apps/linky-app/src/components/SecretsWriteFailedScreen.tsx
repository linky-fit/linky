import { Button, PageScroll, SafeAreaPad, Stack, Text } from "@linky-fit/ui";
import React from "react";
import type { Translate } from "../i18n";
import { SeedWordGrid } from "./SeedWordGrid";

interface SecretsWriteFailedScreenProps {
  backupWords: string;
  /** False when the secure store refused the keys again. */
  onRetry: () => Promise<boolean>;
  onCancel: () => void;
  t: Translate;
}

/** Covers the app when the secure store refused new keys: retry, or write the backup words down first. */
export const SecretsWriteFailedScreen = ({
  backupWords,
  onRetry,
  onCancel,
  t,
}: SecretsWriteFailedScreenProps) => {
  const [wordsVisible, setWordsVisible] = React.useState(false);
  const [retrying, setRetrying] = React.useState(false);
  const [refusedAgain, setRefusedAgain] = React.useState(false);
  const words = backupWords.split(/\s+/).filter(Boolean);
  const retry = async () => {
    setRetrying(true);
    try {
      setRefusedAgain(!(await onRetry()));
    } finally {
      setRetrying(false);
    }
  };
  return (
    <SafeAreaPad
      position="fixed"
      inset="$none"
      zIndex="$overlay"
      backgroundColor="$background"
      edge="top"
    >
      <PageScroll
        gap="$xl"
        padding="$xl"
        width="100%"
        maxWidth="$sheetWidth"
        alignSelf="center"
        justifyContent="center"
      >
        <Stack gap="$xs">
          <Text variant="heading" textAlign="center" role="heading">
            {t("secretsWriteFailedTitle")}
          </Text>
          <Text color="$colorMuted" textAlign="center">
            {t("secretsWriteFailedBody")}
          </Text>
        </Stack>
        {words.length > 0 ? (
          <Stack gap="$sm">
            <Text variant="label" bold>
              {t("secretsWriteFailedWords")}
            </Text>
            <SeedWordGrid words={words} visible={wordsVisible} />
            <Button
              variant="secondary"
              icon={wordsVisible ? "EyeOff" : "Eye"}
              onPress={() => setWordsVisible((current) => !current)}
            >
              {wordsVisible ? t("masterKeysHide") : t("masterKeysShow")}
            </Button>
          </Stack>
        ) : null}
        <Stack gap="$sm">
          {refusedAgain ? (
            <Text color="$dangerText" textAlign="center" role="status">
              {t("secretsWriteFailedAgain")}
            </Text>
          ) : null}
          <Button loading={retrying} onPress={() => void retry()}>
            {t("secretsWriteFailedRetry")}
          </Button>
          <Button variant="secondary" disabled={retrying} onPress={onCancel}>
            {t("cancel")}
          </Button>
        </Stack>
      </PageScroll>
    </SafeAreaPad>
  );
};
