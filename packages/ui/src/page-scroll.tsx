import type { GetProps } from "tamagui";
import { ScrollView } from "tamagui";
import { Stack } from "./layout";

export type PageScrollProps = GetProps<typeof Stack>;

/** A stack that fills its parent and scrolls its content vertically. */
export function PageScroll({ testID, ...props }: PageScrollProps) {
  return (
    <ScrollView
      testID={testID}
      flex={1}
      contentContainerStyle={{ flexGrow: 1 }}
      keyboardShouldPersistTaps="handled"
    >
      <Stack flexGrow={1} {...props} />
    </ScrollView>
  );
}
