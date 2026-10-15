import { Keypad, Row, Stack, SuccessOverlay } from "@linky-fit/ui";
import { border, shadow } from "@linky-fit/ui/tokens";
import type { ComponentProps, ReactNode } from "react";
import "./flow.css";
import { fill } from "./fill";
import { noop } from "./noop";
import { avatarUri, type Person } from "./people";

/** A press target that shows a touch when `on` turns true; `hold` keeps the finger down like a long press. */
export function Tap({
  on,
  hold = false,
  children,
  ...props
}: { on: boolean; hold?: boolean } & ComponentProps<typeof Stack>) {
  return (
    <Stack position="relative" className={on ? "flow-press" : ""} {...props}>
      {children}
      {on ? (
        <Stack
          className={hold ? "flow-tap flow-tap-hold" : "flow-tap"}
          width="$controlLg"
          height="$controlLg"
          borderRadius="$pill"
          borderWidth={border.emphasis}
          borderColor="$surface"
          backgroundColor="$colorMuted"
        />
      ) : null}
    </Stack>
  );
}

export interface FlowScene {
  node: ReactNode;
  /** How the scene arrives: pushed like a new page, returned to with back, opened like a modal, or just shown. */
  enter?: "push" | "back" | "modal" | undefined;
}

/** Shows scene `current`, animating in over the previous one like app navigation. */
export function FlowScenes({
  scenes,
  current,
}: {
  scenes: readonly FlowScene[];
  current: number;
}) {
  const enter = scenes[current]?.enter;
  const leave =
    enter === "push"
      ? "flow-push-out"
      : enter === "back"
        ? "flow-back-out"
        : "";
  return (
    <Stack flex={1} position="relative" overflow="hidden">
      {scenes.map(({ node }, index) =>
        index === current || index === current - 1 ? (
          <Stack
            key={index}
            className={`flow-scene ${
              index === current ? (enter ? `flow-${enter}-in` : "") : leave
            }`}
            {...fill}
            // Going back, the page being left slides off above the one returned to.
            zIndex={index === current - 1 && enter === "back" ? 1 : 0}
            backgroundColor="$background"
          >
            {node}
          </Stack>
        ) : null,
      )}
    </Stack>
  );
}

/** A chat message, a toast or another piece that slides into place. */
export function Arrive({ children }: { children: ReactNode }) {
  return <Stack className="flow-arrive">{children}</Stack>;
}

/** The app's bottom sheet over a dimmed screen; `closing` slides it away. */
export function DemoSheet({
  closing = false,
  children,
  ...props
}: { closing?: boolean } & ComponentProps<typeof Stack>) {
  return (
    <Stack
      {...fill}
      zIndex="$overlay"
      justifyContent="flex-end"
      className={closing ? "flow-sheet-closing" : ""}
    >
      <Stack
        className="flow-sheet-backdrop"
        {...fill}
        backgroundColor="$scrim"
      />
      <Stack
        className="flow-sheet"
        gap="$sm"
        paddingHorizontal="$xl"
        paddingTop="$md"
        paddingBottom="$huge"
        borderTopLeftRadius="$sheet"
        borderTopRightRadius="$sheet"
        backgroundColor="$surface"
        boxShadow={shadow.floating}
        {...props}
      >
        {children}
      </Stack>
    </Stack>
  );
}

/** The app's payment confirmation inside the phone, fading out once `hidden`. */
export function PaymentOverlay({
  title,
  amount,
  person,
  direction,
  pending = false,
  hidden = false,
}: {
  title: string;
  amount: string;
  person: Person;
  direction: "in" | "out";
  pending?: boolean;
  hidden?: boolean;
}) {
  return (
    <Stack
      className={hidden ? "flow-overlay-out" : "flow-fade-in"}
      zIndex="$overlay"
      {...fill}
    >
      <SuccessOverlay
        contained
        title={title}
        amount={amount}
        unit="sat"
        avatar={{ name: person, uri: avatarUri(person) }}
        direction={direction}
        pending={pending}
      />
    </Stack>
  );
}

const keypadRows = ["123", "456", "789", "C0⌫"];

/** The app's keypad with a touch on `pressedKey`; `press` counts presses so a repeated key replays its touch. */
export function TappedKeypad({
  pressedKey,
  press,
  clearLabel = "Clear",
}: {
  pressedKey: string | undefined;
  press: number;
  clearLabel?: string;
}) {
  return (
    <Stack position="relative">
      <Keypad
        accessibilityLabel="Amount (sat)"
        onKeyPress={noop}
        labels={{ clear: clearLabel, decimal: ".", delete: "Delete" }}
      />
      {/* The keypad's keys take no children, so the touches sit on a matching grid above it. */}
      <Stack {...fill} gap="$md" pointerEvents="none">
        {keypadRows.map((row) => (
          <Row key={row} flex={1} gap="$md">
            {Array.from(row, (key) => (
              <Tap
                key={key === pressedKey ? `${key}${press}` : key}
                on={key === pressedKey}
                flex={1}
              />
            ))}
          </Row>
        ))}
      </Stack>
    </Stack>
  );
}
