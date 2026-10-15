import { LoadingState, Stack, Text } from "@linky-fit/ui";
import { useAppLanguage } from "../app/hooks/useAppLanguage";

/** Full-screen wait while the one-time lane-to-shard migration copies local data. */
export const MigratingDataScreen = () => {
  const { t } = useAppLanguage();
  return (
    <Stack
      height="100%"
      justifyContent="center"
      alignItems="center"
      padding="$xl"
    >
      <LoadingState label={t("migratingDataTitle")} />
      <Text color="$colorMuted" textAlign="center">
        {t("migratingDataBody")}
      </Text>
    </Stack>
  );
};
