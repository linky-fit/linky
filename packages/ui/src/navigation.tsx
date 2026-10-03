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
}

const sentenceCase = (text: string) =>
  text.slice(0, 1).toUpperCase() + text.slice(1).toLowerCase();

export function TopBar({ title, content, leading, trailing }: TopBarProps) {
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

/** The bar of main sections docked at the bottom of phone screens; tabs show icons and use labels as their names. */
export function TabBar<T extends string>({
  accessibilityLabel,
  items,
  value,
  onValueChange,
}: TabBarProps<T>) {
  const position = items.findIndex((item) => item.value === value);
  const share = 100 / items.length;
  return (
    <Row
      justifyContent="center"
      paddingHorizontal="$sm"
      paddingVertical="$xs"
      backgroundColor="$surface"
    >
      <Row
        role="tablist"
        aria-label={accessibilityLabel}
        flex={1}
        maxWidth="$sheetWidth"
        gap="$none"
        position="relative"
      >
        {position >= 0 ? (
          <Row
            position="absolute"
            inset={0}
            gap="$none"
            alignItems="stretch"
            pointerEvents="none"
            aria-hidden
          >
            <Stack width={`${position * share}%`} transition="base" />
            <Stack
              width={`${share}%`}
              borderRadius="$control"
              backgroundColor="$accent"
            />
          </Row>
        ) : null}
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
              position="relative"
            >
              {item.leading ??
                (item.icon ? (
                  <Icon
                    name={item.icon}
                    color={active ? "$onAccent" : "$colorMuted"}
                  />
                ) : null)}
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

/** The full-height column of main sections on wide screens; like the TabBar it shows icons only, with labels as names and tooltips. */
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
    const color = active ? "$accentText" : "$colorMuted";
    return (
      <Pressable
        key={item.value}
        aria-current={active ? "page" : undefined}
        aria-label={item.label}
        tooltip={item.label}
        testID={item.testID}
        disabled={item.disabled}
        onPress={() => onValueChange(item.value)}
        flexDirection="column"
        justifyContent="center"
        gap="$sm"
        minHeight="$row"
        paddingVertical="$sm"
        paddingHorizontal="$xs"
        borderRadius="$control"
        backgroundColor={active ? "$accentSoft" : "$transparent"}
        hoverStyle={{
          backgroundColor: active ? "$accentSoft" : "$neutralSoft",
        }}
      >
        {item.leading ??
          (item.icon ? (
            <Icon name={item.icon} size="lg" color={color} />
          ) : null)}
      </Pressable>
    );
  };
  return (
    <Stack
      role="navigation"
      aria-label={accessibilityLabel}
      width="$hero"
      flexShrink={0}
      gap="$xs"
      paddingTop="$lg"
      paddingHorizontal="$sm"
      paddingBottom="$md"
    >
      {header ? (
        <Stack alignItems="center" marginBottom="$xl">
          {header}
        </Stack>
      ) : null}
      <Stack flex={1} gap="$xs">
        {items.map(renderItem)}
      </Stack>
      {footerItems.map(renderItem)}
    </Stack>
  );
}
