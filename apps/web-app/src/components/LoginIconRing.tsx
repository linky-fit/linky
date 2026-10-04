import { Icon, Stack, border, type IconName } from "@linky-fit/ui";
import React from "react";

/** The accent-ringed hero icon of the login dialogs. */
export function LoginIconRing({
  icon,
}: {
  icon: IconName;
}): React.ReactElement {
  return (
    <Stack
      width="$hero"
      height="$hero"
      alignItems="center"
      justifyContent="center"
      borderRadius="$pill"
      borderWidth={border.emphasis}
      borderColor="$accent"
    >
      <Icon name={icon} size="xl" color="$accent" />
    </Stack>
  );
}
