import { Button, Stack, Text } from "@linky-fit/ui";
import type { Translate } from "../i18n";

interface SecretsUnavailableScreenProps {
  onContinue: () => void;
  onRetry: () => void;
  t: Translate;
}

/** Asks the user how to go on when boot could not read the keys this device may hold. */
export const SecretsUnavailableScreen = ({
  onContinue,
  onRetry,
  t,
}: SecretsUnavailableScreenProps) => (
  <Stack
    flex={1}
    justifyContent="center"
    gap="$xl"
    padding="$xl"
    width="100%"
    maxWidth="$sheetWidth"
    alignSelf="center"
  >
    <Stack gap="$xs">
      <Text variant="heading" textAlign="center">
        {t("secretsUnavailableTitle")}
      </Text>
      <Text color="$colorMuted" textAlign="center">
        {t("secretsUnavailableBody")}
      </Text>
    </Stack>
    <Stack gap="$sm">
      <Button onPress={onRetry}>{t("secretsUnavailableRetry")}</Button>
      <Button variant="secondary" onPress={onContinue}>
        {t("secretsUnavailableContinue")}
      </Button>
    </Stack>
  </Stack>
);
