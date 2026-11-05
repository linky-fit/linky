import type { ReactNode } from "react";
import { Pressable } from "./controls";
import { Icon } from "./icons";
import type { IconName } from "./icons";
import { Row, Stack, Text } from "./layout";

export interface TopBarProps {
  title?: string | undefined;
  /** Replaces the title, e.g. with a contact button. */
  content?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  /** A main section's bar: the title as a heading at the start, both actions at the end. */
  large?: boolean | undefined;
}

const sentenceCase = (text: string) =>
  text.slice(0, 1).toUpperCase() + text.slice(1).toLowerCase();

export function TopBar({
  title,
  content,
  leading,
  trailing,
  large = false,
}: TopBarProps) {
  if (large) {
    return (
      <Row
        role="banner"
        minHeight="$controlLg"
        paddingLeft="$xl"
        paddingRight="$md"
        paddingVertical="$sm"
        gap="$xs"
        backgroundColor="$background"
        zIndex="$sticky"
      >
        <Row flex={1}>
          {content ??
            (title ? (
              <Text
                variant="heading"
                color="$colorStrong"
                role="heading"
                aria-label={title}
                numberOfLines={1}
              >
                {sentenceCase(title)}
              </Text>
            ) : null)}
        </Row>
        {leading}
        {trailing}
      </Row>
    );
  }
  return (
    <Row
      role="banner"
      minHeight="$control"
      paddingHorizontal="$xl"
      paddingVertical="$sm"
      gap="$sm"
      backgroundColor="$background"
      zIndex="$sticky"
    >
      <Row minWidth="$control" justifyContent="flex-start">
        {leading}
      </Row>
      <Row flex={1} justifyContent="center">
        {content ??
          (title ? (
            <Text
              variant="label"
              bold
              color="$colorSubtle"
              role="heading"
              aria-label={title}
              numberOfLines={1}
            >
              {sentenceCase(title)}
            </Text>
          ) : null)}
      </Row>
      <Row minWidth="$control" justifyContent="flex-end">
        {trailing}
      </Row>
    </Row>
  );
}

export interface NavItem<T extends string = string> {
  value: T;
  label: string;
  icon?: IconName | undefined;
  /** Replaces the icon, e.g. with the profile avatar. */
  leading?: ReactNode;
  disabled?: boolean | undefined;
  testID?: string | undefined;
}

export interface TabBarProps<T extends string> {
  accessibilityLabel: string;
  items: readonly NavItem<T>[];
  value: T | undefined;
  onValueChange: (value: T) => void;
}

/** The bar of main sections docked at the bottom of phone screens: an icon tab per section, named by its accessible label. */
export function TabBar<T extends string>({
  accessibilityLabel,
  items,
  value,
  onValueChange,
}: TabBarProps<T>) {
  return (
    <Row
      justifyContent="center"
      paddingHorizontal="$xs"
      paddingTop="$sm"
      paddingBottom="$xs"
      backgroundColor="$surface"
    >
      <Row
        role="tablist"
        aria-label={accessibilityLabel}
        flex={1}
        maxWidth="$sheetWidth"
        gap="$none"
      >
        {items.map((item) => {
          const active = item.value === value;
          return (
            <Pressable
              key={item.value}
              role="tab"
              aria-selected={active}
              aria-label={item.label}
              testID={item.testID}
              disabled={item.disabled}
              onPress={() => onValueChange(item.value)}
              flex={1}
              justifyContent="center"
              minHeight="$control"
            >
              <Row
                justifyContent="center"
                width="$controlLg"
                height="$controlSm"
                borderRadius="$pill"
                backgroundColor={active ? "$accentSoft" : "$transparent"}
                transition="fast"
              >
                {item.leading ??
                  (item.icon ? (
                    <Icon
                      name={item.icon}
                      color={active ? "$accentText" : "$colorMuted"}
                    />
                  ) : null)}
              </Row>
            </Pressable>
          );
        })}
      </Row>
    </Row>
  );
}

export interface NavigationRailProps<T extends string> {
  accessibilityLabel: string;
  items: readonly NavItem<T>[];
  /** Pinned to the bottom of the rail, e.g. settings. */
  footerItems?: readonly NavItem<T>[] | undefined;
  value: T | undefined;
  onValueChange: (value: T) => void;
  /** Centered above the items, e.g. the profile avatar. */
  header?: ReactNode;
}

/** The full-height column of main sections on wide screens: an icon tile per section, named by its tooltip. */
export function NavigationRail<T extends string>({
  accessibilityLabel,
  items,
  footerItems = [],
  value,
  onValueChange,
  header,
}: NavigationRailProps<T>) {
  const renderItem = (item: NavItem<T>) => {
    const active = item.value === value;
    return (
      <Pressable
        key={item.value}
        aria-current={active ? "page" : undefined}
        aria-label={item.label}
        tooltip={item.label}
        testID={item.testID}
        disabled={item.disabled}
        onPress={() => onValueChange(item.value)}
        justifyContent="center"
        width="$avatar"
        height="$avatar"
        borderRadius="$control"
        backgroundColor={active ? "$accentSoft" : "$transparent"}
        hoverStyle={{
          backgroundColor: active ? "$accentSoft" : "$neutralSoft",
        }}
        transition="fast"
      >
        {item.leading ??
          (item.icon ? (
            <Icon
              name={item.icon}
              color={active ? "$accentText" : "$colorMuted"}
            />
          ) : null)}
      </Pressable>
    );
  };
  return (
    <Stack
      role="navigation"
      aria-label={accessibilityLabel}
      flexShrink={0}
      alignItems="center"
      gap="$sm"
      paddingTop="$lg"
      paddingHorizontal="$sm"
      paddingBottom="$md"
      backgroundColor="$surface"
    >
      {header ? <Stack marginBottom="$lg">{header}</Stack> : null}
      <Stack flex={1} gap="$sm">
        {items.map(renderItem)}
      </Stack>
      {footerItems.map(renderItem)}
    </Stack>
  );
}
