import {
  Amount,
  Avatar,
  AvatarGroup,
  Card,
  Row,
  Stack,
  Text,
  useMedia,
  type Tone,
} from "@linky-fit/ui";
import { themes } from "@linky-fit/ui/tokens";
import type { CSSProperties, ReactNode } from "react";
import { useColorMode } from "../colorMode";
import type { LandingCopy } from "./copy";
import { avatarUri, type Person } from "./demo/people";
import { AppLaunch, Glow, Phone, Pulse } from "./parts";
import { percent, type Point } from "./stage";

interface NetworkNode extends Point {
  name: Person;
  indicator?: Tone;
}

// Percent positions around the phones; the hub is where payments arrive.
const hub = { x: 62, y: 46 };
const nodes: NetworkNode[] = [
  { name: "Mia Novak", x: 4, y: 10, indicator: "accent" },
  { name: "Alex Rivers", x: 46, y: -4 },
  { name: "Tomas Berg", x: 98, y: 4 },
  { name: "Lena Fox", x: 104, y: 40, indicator: "accent" },
  { name: "Sam Ortiz", x: 96, y: 88 },
  { name: "Eva Lind", x: 52, y: 102 },
  { name: "Jan Kral", x: 2, y: 92, indicator: "accent" },
  { name: "Mom", x: -6, y: 50 },
];
const pulses = [0, 3, 6, 2, 4];

function Network() {
  const { borderColorHover } = themes[useColorMode()];
  return (
    <>
      <svg
        className="landing-network"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden
      >
        {nodes.map((node, index) => {
          const next = nodes[(index + 1) % nodes.length] ?? node;
          return (
            <g key={node.name} stroke={borderColorHover} strokeWidth={1}>
              <line
                x1={node.x}
                y1={node.y}
                x2={hub.x}
                y2={hub.y}
                vectorEffect="non-scaling-stroke"
              />
              <line
                x1={node.x}
                y1={node.y}
                x2={next.x}
                y2={next.y}
                strokeDasharray="2 6"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          );
        })}
      </svg>
      {pulses.map((nodeIndex, order) => {
        const node = nodes[nodeIndex];
        return node ? (
          <Pulse key={node.name} from={node} to={hub} delay={order * 0.7} />
        ) : null;
      })}
      {nodes.map((node) => (
        <div
          key={node.name}
          aria-hidden
          className="landing-node"
          style={{ left: percent(node.x), top: percent(node.y) }}
        >
          <Avatar
            name={node.name}
            uri={avatarUri(node.name)}
            size="sm"
            indicator={node.indicator}
          />
        </div>
      ))}
    </>
  );
}

function PaymentCard() {
  return (
    <Card elevated outlined padding="$md" gap="$xs" minWidth="$column">
      <Row gap="$sm">
        <Avatar name="Mia Novak" uri={avatarUri("Mia Novak")} size="sm" />
        <Text variant="caption" color="$colorMuted">
          Mia Novak
        </Text>
      </Row>
      <Amount value="+21 000" unit="sat" size="md" />
    </Card>
  );
}

function NetworkCard() {
  return (
    <Card elevated outlined padding="$md">
      <AvatarGroup
        people={nodes.map(({ name }) => ({ name, uri: avatarUri(name) }))}
        max={4}
        size="sm"
      />
    </Card>
  );
}

/** Places a piece of the stage at percent offsets, which the strict style props reject. */
function Placed({
  children,
  className,
  ...placement
}: Pick<CSSProperties, "left" | "right" | "top" | "bottom" | "opacity"> & {
  children: ReactNode;
  className: string;
}) {
  return (
    <div className={className} style={{ position: "absolute", ...placement }}>
      {children}
    </div>
  );
}

function Stage({ wide }: { wide: boolean }) {
  return (
    <Stack
      position="relative"
      width="100%"
      maxWidth={wide ? "$sheetWidth" : "$device"}
      aspectRatio={wide ? 0.78 : 0.82}
      alignSelf="center"
      gap="$none"
    >
      <Glow size="110%" top="50%" left="58%" />
      <Network />
      <Placed left="-2%" top="16%" opacity={0.75} className="landing-tilt-back">
        <Phone screen="wallet" width={wide ? "$qr" : "$column"} />
      </Placed>
      <Placed right="4%" top="2%" className="landing-tilt">
        <Phone screen="contacts" width={wide ? "$device" : "$qr"} />
      </Placed>
      <Placed left="-4%" bottom={wide ? "14%" : "6%"} className="landing-float">
        <PaymentCard />
      </Placed>
      {wide ? (
        <Placed right="-6%" top="58%" className="landing-float-late">
          <NetworkCard />
        </Placed>
      ) : null}
    </Stack>
  );
}

export function Hero({ copy }: { copy: LandingCopy }) {
  const { wide } = useMedia();
  const [before = "", after = ""] = copy.title.split(copy.titleAccent);
  const variant = wide ? "headline" : "amount";
  const Columns = wide ? Row : Stack;

  return (
    <Columns
      gap="$huge"
      alignItems="center"
      paddingTop={wide ? "$huge" : "$xxl"}
      paddingBottom="$huge"
    >
      <Stack flex={wide ? 1 : undefined} gap="$xxl">
        <Text
          className="landing-rise"
          variant={variant}
          color="$colorStrong"
          role="heading"
          aria-level={1}
        >
          {before}
          <Text variant={variant} color="$accent">
            {copy.titleAccent}
          </Text>
          {after}
        </Text>
        <Text
          className="landing-rise landing-delay-1"
          variant="title"
          fontWeight="$regular"
          color="$colorMuted"
          maxWidth="$sheetWidth"
        >
          {copy.subtitle}
        </Text>
        <Stack className="landing-rise landing-delay-2">
          <AppLaunch copy={copy} />
        </Stack>
      </Stack>
      <Stack
        flex={wide ? 1 : undefined}
        width="100%"
        className="landing-rise landing-delay-3"
        paddingVertical={wide ? "$none" : "$xxl"}
      >
        <Stage wide={wide} />
      </Stack>
    </Columns>
  );
}
