import { TopBar, space, SafeAreaPad } from "@linky-fit/ui";
import type { TopBarProps } from "@linky-fit/ui";

/** A top bar pinned to the top of the scrolling page, spanning its gutter. */
export function StickyTopBar(props: TopBarProps) {
  return (
    <SafeAreaPad
      position="sticky"
      top="$none"
      marginHorizontal={-space.xl}
      zIndex="$sticky"
      backgroundColor="$background"
      edge="top"
    >
      <TopBar {...props} />
    </SafeAreaPad>
  );
}
