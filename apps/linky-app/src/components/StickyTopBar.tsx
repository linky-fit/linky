import { Stack, TopBar, space } from "@linky-fit/ui";
import type { TopBarProps } from "@linky-fit/ui";

/** A top bar pinned to the top of the scrolling page, spanning its gutter. */
export function StickyTopBar(props: TopBarProps) {
  return (
    <Stack
      position="sticky"
      top="$none"
      marginHorizontal={-space.xl}
      zIndex="$sticky"
      backgroundColor="$background"
      data-safe-area="top"
    >
      <TopBar {...props} />
    </Stack>
  );
}
