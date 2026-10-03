import { IconButton, Stack, size, space, useMedia } from "@linky-fit/ui";
import type { IconName } from "@linky-fit/ui";

/** Bottom padding that keeps a page's last content clear of the button. */
export const floatingActionButtonClearance = size.controlLg + space.xxxl;

interface FloatingActionButtonProps {
  icon: IconName;
  label: string;
  onPress: () => void;
  guide?: string;
}

/** The round page action in the corner of the page area, above the phone tab bar. */
export function FloatingActionButton({
  icon,
  label,
  onPress,
  guide,
}: FloatingActionButtonProps) {
  const { wide } = useMedia();
  return (
    <Stack
      position="absolute"
      right={wide ? "$xxl" : "$xl"}
      bottom={wide ? "$xxl" : "$xxxl"}
      zIndex="$sticky"
      data-safe-area={wide ? undefined : "bottom"}
    >
      <IconButton
        icon={icon}
        accessibilityLabel={label}
        variant="primary"
        size="lg"
        onPress={onPress}
        data-guide={guide}
        tooltip={label}
      />
    </Stack>
  );
}
