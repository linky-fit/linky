import { Button } from "./controls";
import { Icon } from "./icons";
import { Stack, Text } from "./layout";

export interface CheckboxProps {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}

export function Checkbox({
  label,
  checked,
  onCheckedChange,
  disabled,
}: CheckboxProps) {
  return (
    <Button
      variant="ghost"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onPress={() => onCheckedChange(!checked)}
      justifyContent="space-between"
      paddingHorizontal={0}
    >
      <Text flex={1} textAlign="left">
        {label}
      </Text>
      <Stack
        width={24}
        height={24}
        borderRadius={4}
        borderWidth={1}
        borderColor={checked ? "$accent" : "$muted"}
        backgroundColor={checked ? "$accent" : "$transparent"}
        alignItems="center"
        justifyContent="center"
        aria-hidden
      >
        {checked ? <Icon name="Check" size={18} color="$onAccent" /> : null}
      </Stack>
    </Button>
  );
}
