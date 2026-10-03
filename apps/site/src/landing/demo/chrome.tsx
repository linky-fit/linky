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
import { noop } from "./noop";
import { avatarUri, type Person } from "./people";

type Tab = "profile" | "contacts" | "wallet" | "proxy" | "settings";

/** The app's top bar: a title or a contact, with optional icon actions. */
export function DemoTopBar({
  title,
  contact,
  leading,
  trailing,
}: {
  title?: string;
  contact?: Person;
  leading?: IconName;
  trailing?: IconName;
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
      trailing={action(trailing)}
    />
  );
}

/** The app's docked section tabs. */
export function DemoTabBar({ active }: { active: Tab }) {
  return (
    <Stack backgroundColor="$surface">
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
