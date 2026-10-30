import { Screen, ScrollView, Stack, TopBar } from "@linky-fit/ui";
import type { ReactNode } from "react";

/** A scrolling page in a narrow column, centered on wide screens; `title` names it in a top bar, like the payment screen. */
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
  const page = (
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
        {children}
      </Screen>
    </ScrollView>
  );
  if (!title) return page;
  return (
    <Stack flex={1} gap="$none" minHeight={0}>
      <Stack width="100%" maxWidth="$sheetWidth" alignSelf="center">
        <TopBar title={title} />
      </Stack>
      {page}
    </Stack>
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
