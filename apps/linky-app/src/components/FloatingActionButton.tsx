import {
  Button,
  IconButton,
  shadow,
  Stack,
  size,
  space,
  useMedia,
} from "@linky-fit/ui";
import type { IconName } from "@linky-fit/ui";

/** Bottom padding that keeps a page's last content clear of the button. */
export const floatingActionButtonClearance = size.controlLg + space.xxxl;

interface FloatingActionButtonProps {
  icon: IconName;
  label: string;
  onPress: () => void;
  guide?: string;
  /** Stays in the corner on wide screens too, e.g. under a list column that scrolls on its own. */
  pinned?: boolean;
}

/** The page action: a round icon in the corner above the phone tab bar; on wide screens a labelled pill where the page renders it, so pages render it first. */
export function FloatingActionButton({
  icon,
  label,
  onPress,
  guide,
  pinned = false,
}: FloatingActionButtonProps) {
  const { wide } = useMedia();
  if (wide && !pinned) {
    return (
      <Stack alignSelf="flex-end">
        <Button icon={icon} onPress={onPress} data-guide={guide}>
          {label}
        </Button>
      </Stack>
    );
  }
  return (
    <Stack
      position="absolute"
      right={wide ? "$xxl" : "$xl"}
      bottom={wide ? "$xxl" : "$xxxl"}
      zIndex="$sticky"
      data-safe-area={wide ? undefined : "bottom"}
    >
      {wide ? (
        <Button
          icon={icon}
          borderRadius="$pill"
          boxShadow={shadow.raised}
          onPress={onPress}
          data-guide={guide}
        >
          {label}
        </Button>
      ) : (
        <IconButton
          icon={icon}
          accessibilityLabel={label}
          variant="primary"
          size="lg"
          onPress={onPress}
          data-guide={guide}
          tooltip={label}
        />
      )}
    </Stack>
  );
}
