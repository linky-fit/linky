import type { GetProps } from "tamagui";
import type { LogScrollProps } from "./page-scroll";
import { Stack } from "./layout";

export type PageScrollProps = GetProps<typeof Stack>;

/** A stack that fills its parent and scrolls its content vertically. */
export function PageScroll(props: PageScrollProps) {
  return <Stack flex={1} minHeight={0} overflowY="auto" {...props} />;
}

/** A stack that fills its parent and scrolls vertically, e.g. a chat log; its owner keeps the end in view. */
export function LogScroll(props: LogScrollProps) {
  return <Stack flex={1} minHeight={0} overflowY="auto" {...props} />;
}
