import { Stack, Text } from "@linky-fit/ui";
import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { SupporterBadgeDisplayOptions } from "../components/SupporterBadgeDisplayOptions";

export function SupporterBadgePage(): React.ReactElement {
  const { t } = useAppShellCore();
  return (
    <Stack gap="$md">
      <Text color="$colorMuted">{t("supporterBadgeDisplayHint")}</Text>
      <SupporterBadgeDisplayOptions />
    </Stack>
  );
}
