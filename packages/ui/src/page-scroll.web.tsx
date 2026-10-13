import type { GetProps } from "tamagui";
import { Stack } from "./layout";

export type PageScrollProps = GetProps<typeof Stack>;

/** A stack that fills its parent and scrolls its content vertically. */
export function PageScroll(props: PageScrollProps) {
  return <Stack flex={1} minHeight={0} overflowY="auto" {...props} />;
}
