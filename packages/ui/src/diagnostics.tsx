import { useState } from "react";
import type { ReactNode } from "react";
import { ScrollView } from "tamagui";
import { Pressable } from "./controls";
import { Icon } from "./icons";
import { Row, Stack, Text } from "./layout";
import { border, size } from "./tokens";

export interface DataColumn {
  key: string;
  label: string;
  /** In columns of the default width, or the share of the width with `fill`. */
  span?: number | undefined;
}

export interface DataRow {
  key: string;
  cells: readonly ReactNode[];
}

export interface DataTableProps {
  accessibilityLabel: string;
  columns: readonly DataColumn[];
  rows: readonly DataRow[];
  /** Shares the available width between the columns instead of scrolling sideways. */
  fill?: boolean | undefined;
}

export function DataTable({
  accessibilityLabel,
  columns,
  rows,
  fill = false,
}: DataTableProps) {
  const width = (column: DataColumn) =>
    fill
      ? { flex: column.span ?? 1, flexBasis: 0 }
      : { width: (column.span ?? 1) * size.column };
  const table = (
    <Stack role="table" aria-label={accessibilityLabel} gap="$none">
      <Row role="row" gap="$none" backgroundColor="$neutralSoft">
        {columns.map((column) => (
          <Text
            key={column.key}
            role="columnheader"
            variant="label"
            {...width(column)}
            padding="$sm"
          >
            {column.label}
          </Text>
        ))}
      </Row>
      {rows.map((row) => (
        <Row
          key={row.key}
          role="row"
          gap="$none"
          alignItems="flex-start"
          borderBottomWidth={border.hairline}
          borderColor="$borderColor"
        >
          {columns.map((column, index) => (
            <Stack
              key={column.key}
              role="cell"
              {...width(column)}
              padding="$sm"
            >
              {typeof row.cells[index] === "string" ||
              typeof row.cells[index] === "number" ? (
                <Text variant="caption" userSelect="text">
                  {row.cells[index]}
                </Text>
              ) : (
                row.cells[index]
              )}
            </Stack>
          ))}
        </Row>
      ))}
    </Stack>
  );
  return fill ? table : <ScrollView horizontal>{table}</ScrollView>;
}

export interface DisclosureProps {
  title: string;
  children: ReactNode;
}

export function Disclosure({ title, children }: DisclosureProps) {
  const [open, setOpen] = useState(false);
  return (
    <Stack gap="$sm">
      <Pressable
        gap="$sm"
        minHeight="$control"
        aria-expanded={open}
        onPress={() => setOpen(!open)}
      >
        <Icon
          name={open ? "ChevronDown" : "ChevronRight"}
          size="sm"
          color="$colorMuted"
        />
        <Text variant="label">{title}</Text>
      </Pressable>
      {open ? children : null}
    </Stack>
  );
}

/** Selectable monospace text: keys, tokens, invoices and logs. */
export function CodeBlock({
  children,
  testID,
}: {
  children: string;
  testID?: string | undefined;
}) {
  return (
    <Text
      testID={testID}
      mono
      variant="caption"
      userSelect="text"
      // Breaking inside long tokens keeps a wrapped line's indentation; Tamagui has no wordBreak prop.
      $platform-web={{ wordBreak: "break-all" }}
      padding="$md"
      borderRadius="$control"
      backgroundColor="$neutralSoft"
      color="$colorStrong"
    >
      {children}
    </Text>
  );
}
