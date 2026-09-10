import type { ReactNode } from "react";
import { Button, IconButton } from "./controls";
import { Avatar } from "./people";
import { Icon } from "./icons";
import type { IconName } from "./icons";
import { Row, Stack, Text } from "./layout";

export interface ScreenHeaderProps {
  title: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  back?: { label: string; onPress: () => void };
}
export function ScreenHeader({
  title,
  leading,
  trailing,
  back,
}: ScreenHeaderProps) {
  return (
    <Row
      minHeight={76}
      paddingHorizontal="$lg"
      paddingTop="$lg"
      paddingBottom="$sm"
      gap="$sm"
    >
      {back ? (
        <IconButton
          label={back.label}
          icon="ArrowLeft"
          onPress={back.onPress}
        />
      ) : (
        (leading ?? <Stack width={44} />)
      )}
      <Text variant="title" role="heading" flex={1} textAlign="center">
        {title}
      </Text>
      {trailing ?? <Stack width={44} />}
    </Row>
  );
}
export interface ConversationHeaderProps {
  name: string;
  uri?: string;
  subtitle?: string;
  backLabel: string;
  onBack: () => void;
  actions?: ReactNode;
}
export function ConversationHeader({
  name,
  uri,
  subtitle,
  backLabel,
  onBack,
  actions,
}: ConversationHeaderProps) {
  return (
    <Row
      minHeight={80}
      padding="$md"
      gap="$sm"
      borderBottomWidth={1}
      borderColor="$surfaceRaised"
    >
      <IconButton label={backLabel} icon="ArrowLeft" onPress={onBack} />
      <Avatar name={name} {...(uri ? { uri } : {})} />
      <Stack flex={1} gap="$xs">
        <Text role="heading" fontWeight="700" numberOfLines={1}>
          {name}
        </Text>
        {subtitle ? (
          <Text variant="caption" muted>
            {subtitle}
          </Text>
        ) : null}
      </Stack>
      {actions}
    </Row>
  );
}
export interface NavItem {
  value: string;
  label: string;
  icon: IconName;
}
export interface BottomNavProps {
  label: string;
  items: readonly NavItem[];
  value: string;
  onValueChange: (value: string) => void;
}
export function BottomNav({
  label,
  items,
  value,
  onValueChange,
}: BottomNavProps) {
  return (
    <Row
      role="navigation"
      aria-label={label}
      width="100%"
      maxWidth={360}
      padding={5}
      gap={0}
      borderRadius="$pill"
      backgroundColor="$surface"
      shadowColor="$shadowColor"
      shadowOffset={{ width: 0, height: 8 }}
      shadowRadius={28}
    >
      <Row flex={1} gap={0}>
        {items.map((item) => (
          <Button
            key={item.value}
            flex={1}
            variant="ghost"
            size="small"
            gap="$sm"
            borderRadius="$pill"
            backgroundColor={
              item.value === value ? "$accentSoft" : "$transparent"
            }
            aria-current={item.value === value ? "page" : undefined}
            onPress={() => onValueChange(item.value)}
          >
            <Icon
              name={item.icon}
              size={22}
              color={item.value === value ? "$accent" : "$muted"}
            />
            <Text
              variant="label"
              color={item.value === value ? "$accent" : "$muted"}
              flexShrink={1}
            >
              {item.label}
            </Text>
          </Button>
        ))}
      </Row>
    </Row>
  );
}
