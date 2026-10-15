import {
  Avatar,
  IconButton,
  Row,
  Stack,
  TabBar,
  Text,
  TopBar,
  type IconName,
} from "@linky-fit/ui";
import type { ComponentProps } from "react";
import { fill } from "./fill";
import { Tap } from "./flow";
import { noop } from "./noop";
import { avatarUri, type Person } from "./people";

export type Tab = "profile" | "contacts" | "wallet" | "proxy" | "settings";

/** The app's top bar: a title or a contact, with optional icon actions; `tapTrailing` touches the trailing one. */
export function DemoTopBar({
  title,
  contact,
  leading,
  trailing,
  tapTrailing = false,
}: {
  title?: string;
  contact?: Person;
  leading?: IconName;
  trailing?: IconName;
  tapTrailing?: boolean;
}) {
  const action = (icon: IconName | undefined) =>
    icon ? (
      <IconButton
        icon={icon}
        size="sm"
        accessibilityLabel={icon}
        onPress={noop}
      />
    ) : null;
  return (
    <TopBar
      title={title}
      content={
        contact ? (
          <Row gap="$sm">
            <Avatar name={contact} uri={avatarUri(contact)} size="sm" />
            <Text variant="label" bold color="$colorSubtle">
              {contact}
            </Text>
          </Row>
        ) : undefined
      }
      leading={action(leading)}
      trailing={
        trailing ? <Tap on={tapTrailing}>{action(trailing)}</Tap> : null
      }
    />
  );
}

const tabs: readonly Tab[] = [
  "profile",
  "contacts",
  "wallet",
  "proxy",
  "settings",
];

/** The app's docked section tabs, reaching under the home indicator, with a touch on `tap`. */
export function DemoTabBar({
  active,
  tap,
}: {
  active: Tab;
  tap?: Tab | undefined;
}) {
  return (
    <Stack position="relative" backgroundColor="$surface" paddingBottom="$xl">
      <TabBar
        accessibilityLabel="Sections"
        value={active}
        onValueChange={noop}
        items={[
          {
            value: "profile",
            label: "Profile",
            leading: <Avatar name="Dave" uri={avatarUri("Dave")} size="xs" />,
          },
          { value: "contacts", label: "Contacts", icon: "Users" },
          { value: "wallet", label: "Wallet", icon: "Wallet" },
          { value: "proxy", label: "Proxy payments", icon: "HandCoins" },
          { value: "settings", label: "Settings", icon: "Settings" },
        ]}
      />
      {/* The tabs take no children, so the touch sits on a matching row above them. */}
      <Row {...fill} bottom="$xl" gap="$none" pointerEvents="none">
        {tabs.map((tab) => (
          <Tap key={tab} on={tab === tap} flex={1} />
        ))}
      </Row>
    </Stack>
  );
}

/** A screen body between the bars, with the app's page gutter. */
export function DemoBody(props: ComponentProps<typeof Stack>) {
  return (
    <Stack
      flex={1}
      gap="$md"
      paddingHorizontal="$xl"
      overflow="hidden"
      {...props}
    />
  );
}
