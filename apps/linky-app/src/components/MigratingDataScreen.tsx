import { Spinner, Stack, Text } from "@linky-fit/ui";
import { useAppLanguage } from "../app/hooks/useAppLanguage";

/** Full-screen wait while the one-time lane-to-shard migration copies local data, laid out as the hydration screen. */
export const MigratingDataScreen = () => {
  const { t } = useAppLanguage();
  return (
    <Stack
      flex={1}
      justifyContent="center"
      alignItems="center"
      gap="$xl"
      padding="$xl"
      width="100%"
      maxWidth="$sheetWidth"
      alignSelf="center"
    >
      <Spinner size="lg" accessibilityLabel={t("migratingDataTitle")} />
      <Stack gap="$xs">
        <Text variant="heading" textAlign="center">
          {t("migratingDataTitle")}
        </Text>
        <Text color="$colorMuted" textAlign="center">
          {t("migratingDataBody")}
        </Text>
      </Stack>
    </Stack>
  );
};
