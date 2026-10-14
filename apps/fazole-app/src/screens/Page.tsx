import { Screen, ScrollView, Stack, Text } from "@linky-fit/ui";
import type { ReactNode } from "react";

/** A scrolling page in a narrow column, centered on wide screens. */
export function Page({
  title,
  centered = false,
  testID,
  children,
}: {
  readonly title?: string | undefined;
  /** Centers short content vertically, e.g. the welcome screen. */
  readonly centered?: boolean | undefined;
  readonly testID?: string | undefined;
  readonly children: ReactNode;
}) {
  return (
    <ScrollView
      flex={1}
      contentContainerStyle={{ flexGrow: 1 }}
      keyboardShouldPersistTaps="handled"
    >
      <Screen
        testID={testID}
        width="100%"
        maxWidth="$sheetWidth"
        alignSelf="center"
        justifyContent={centered ? "center" : "flex-start"}
        gap="$xl"
      >
        {title ? (
          <Text variant="heading" role="heading">
            {title}
          </Text>
        ) : null}
        {children}
      </Screen>
    </ScrollView>
  );
}

/** A full-height column: a fixed top bar above a scrolling page. */
export function WithTopBar({
  topBar,
  children,
}: {
  readonly topBar: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <Stack flex={1} gap="$none" minHeight={0}>
      {topBar}
      {children}
    </Stack>
  );
}
