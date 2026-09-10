import { useState } from "react";
import { Button } from "./controls";
import { Dialog } from "./feedback";
import { Icon } from "./icons";
import { Stack, Text } from "./layout";
export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}
export interface SelectFieldProps {
  label: string;
  description: string;
  closeLabel: string;
  value: string;
  options: readonly SelectOption[];
  onValueChange: (value: string) => void;
  disabled?: boolean;
}
export function SelectField({
  label,
  description,
  closeLabel,
  value,
  options,
  onValueChange,
  disabled,
}: SelectFieldProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  return (
    <Stack gap="$sm">
      <Text variant="label" color="$subtle">
        {label}
      </Text>
      <Button
        variant="secondary"
        justifyContent="space-between"
        disabled={disabled}
        aria-label={`${label}: ${selected?.label ?? ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onPress={() => setOpen(true)}
      >
        <Text flex={1}>{selected?.label ?? label}</Text>
        <Icon name="ChevronDown" />
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={label}
        description={description}
        closeLabel={closeLabel}
      >
        {options.map((option) => (
          <Button
            key={option.value}
            variant="ghost"
            aria-pressed={option.value === value}
            disabled={option.disabled}
            onPress={() => {
              onValueChange(option.value);
              setOpen(false);
            }}
          >
            {option.label}
            {option.value === value ? (
              <Icon name="Check" color="$accent" />
            ) : null}
          </Button>
        ))}
      </Dialog>
    </Stack>
  );
}
