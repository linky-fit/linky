import {
  BrandMark,
  Card,
  Icon,
  LinkPreview,
  MessageBubble,
  QRCode,
  Row,
  Stack,
  Text,
  useMedia,
} from "@linky-fit/ui";
import { opacity, shadow, size, space, themes } from "@linky-fit/ui/tokens";
import { Fragment, type ReactNode } from "react";
import { useColorMode } from "../colorMode";
import type { LandingCopy, TokenSectionCopy } from "./copy";
import { Glow, Phone, Pulse, Reveal } from "./parts";
import { percent, useInView, type Point } from "./stage";

const tokenLink =
  "https://linky.fit/cashu#cashuBo2Ftdmh0dHBzOi8vbWludC5saW5reS5maXRhdWNzYXRhdIGiYWlIAK0mjE0fWCZhcIWjYWEZEABhc3hANmMzYzA4MWRjOGMzNGU0";

function MessengerMock() {
  return (
    <Card outlined elevated padding="$md" gap="$sm" width="$qr">
      <MessageBubble direction="outgoing">
        <Text>5,000 sat for you!</Text>
        <LinkPreview
          site="linky.fit"
          title="5,000 sat"
          description="Cashu token, tap to receive"
          href={tokenLink}
        />
      </MessageBubble>
      <MessageBubble direction="incoming">Thank you!</MessageBubble>
    </Card>
  );
}

const qrTile = size.qr + 2 * space.lg;
const qrZoom = size.column / qrTile;

function QrMock() {
  const { accent } = themes[useColorMode()];
  return (
    <div className="landing-qr">
      <div style={{ zoom: qrZoom, width: qrTile }}>
        <QRCode value={tokenLink} accessibilityLabel="5,000 sat" />
      </div>
      <div
        className="landing-scan"
        style={{ background: accent, boxShadow: `0 0 12px 2px ${accent}` }}
      />
    </div>
  );
}

function NfcMock() {
  const { accent } = themes[useColorMode()];
  return (
    <div className="landing-nfc">
      <Stack
        width="$qr"
        aspectRatio={1.586}
        padding="$lg"
        borderRadius="$card"
        backgroundColor="$qrBackground"
        boxShadow={shadow.floating}
        justifyContent="space-between"
      >
        <Row justifyContent="space-between" alignItems="flex-start">
          <BrandMark size="iconXl" />
          <Stack position="relative" gap="$none">
            {[0, 1].map((ring) => (
              <div
                key={ring}
                className="landing-ripple"
                style={{ borderColor: accent, animationDelay: `${ring}s` }}
              />
            ))}
            <Icon name="Radio" size="lg" color="$qrForeground" />
          </Stack>
        </Row>
        <Row justifyContent="space-between" alignItems="flex-end">
          <Text variant="title" color="$qrForeground">
            5,000 sat
          </Text>
          <Text
            variant="caption"
            color="$qrForeground"
            opacity={opacity.dimmed}
          >
            linky.fit
          </Text>
        </Row>
      </Stack>
    </div>
  );
}

const destinations = [
  { caption: "messenger", Mock: MessengerMock },
  { caption: "qrCode", Mock: QrMock },
  { caption: "nfcCard", Mock: NfcMock },
] satisfies { caption: keyof TokenSectionCopy; Mock: () => ReactNode }[];

const pulseGap = 0.8;
const pointKey = ({ x, y }: Point) => `${x}-${y}`;
const appearDelay = (order: number) => ({
  transitionDelay: `${200 + order * 300}ms`,
});

/** Lines from one percent point to others, with pulses running along them. */
function Connectors({
  from,
  to,
  delay = 0,
}: {
  from: Point;
  to: Point[];
  delay?: number;
}) {
  const { borderColorHover } = themes[useColorMode()];
  return (
    <>
      <svg
        className="landing-network"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden
      >
        {to.map((point) => (
          <line
            key={pointKey(point)}
            x1={from.x}
            y1={from.y}
            x2={point.x}
            y2={point.y}
            stroke={borderColorHover}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      {to.map((point, index) => (
        <Pulse
          key={pointKey(point)}
          from={from}
          to={point}
          delay={delay + index * pulseGap}
          duration={2.4}
        />
      ))}
      {[from, ...to].map((point) => (
        <div
          key={pointKey(point)}
          aria-hidden
          className="landing-node"
          style={{ left: percent(point.x), top: percent(point.y) }}
        >
          <Stack
            width="$dot"
            height="$dot"
            borderRadius="$pill"
            backgroundColor="$accent"
          />
        </div>
      ))}
    </>
  );
}

function WideStage({ copy }: { copy: TokenSectionCopy }) {
  const slotCenters = destinations.map((_, index) => ({
    x: 100,
    y: ((2 * index + 1) / (2 * destinations.length)) * 100,
  }));
  return (
    <Row gap="$none" alignItems="stretch" justifyContent="center">
      <Stack position="relative" justifyContent="center" gap="$none">
        <Glow size="150%" top="50%" left="50%" />
        <div className="landing-handoff-item">
          <Phone screen="token-share" />
        </div>
      </Stack>
      <Stack width="$column" position="relative" gap="$none">
        <Connectors from={{ x: 0, y: 50 }} to={slotCenters} />
      </Stack>
      <Stack width="$sheetWidth" gap="$none">
        {destinations.map(({ caption, Mock }, index) => (
          <Row key={caption} flex={1} alignItems="center" gap="$none">
            <div className="landing-handoff-item" style={appearDelay(index)}>
              <Row alignItems="center" gap="$xl">
                <Stack width="$qr" gap="$none" alignItems="flex-start">
                  <div inert>
                    <Mock />
                  </div>
                </Stack>
                <Text variant="title" color="$colorStrong" flex={1}>
                  {copy[caption]}
                </Text>
              </Row>
            </div>
          </Row>
        ))}
      </Stack>
    </Row>
  );
}

function CompactStage({ copy }: { copy: TokenSectionCopy }) {
  return (
    <Stack alignItems="center" gap="$none">
      <Stack position="relative" gap="$none">
        <Glow size="150%" top="50%" left="50%" />
        <div className="landing-handoff-item">
          <Phone screen="token-share" width="$qr" />
        </div>
      </Stack>
      {destinations.map(({ caption, Mock }, index) => (
        <Fragment key={caption}>
          <Stack width="100%" height="$row" position="relative" gap="$none">
            <Connectors
              from={{ x: 50, y: 0 }}
              to={[{ x: 50, y: 100 }]}
              delay={index * pulseGap}
            />
          </Stack>
          <div className="landing-handoff-item" style={appearDelay(index)}>
            <Stack alignItems="center" gap="$lg">
              <div inert>
                <Mock />
              </div>
              <Text variant="title" color="$colorStrong" textAlign="center">
                {copy[caption]}
              </Text>
            </Stack>
          </div>
        </Fragment>
      ))}
    </Stack>
  );
}

/** A cashu token reaches anyone: through a messenger, a QR code or an NFC card. */
export function TokenSection({ copy }: { copy: LandingCopy }) {
  const { wide } = useMedia();
  const { ref, visible } = useInView();
  const section = copy.tokenSection;
  return (
    <Stack gap="$huge" paddingVertical="$huge">
      <Reveal>
        <Stack alignItems="center" gap="$lg">
          <Stack alignItems="center" gap="$sm">
            <Text eyebrow color="$accent">
              {section.eyebrow}
            </Text>
            <Text
              variant={wide ? "amount" : "display"}
              color="$colorStrong"
              textAlign="center"
              role="heading"
              aria-level={2}
            >
              {section.title}
            </Text>
          </Stack>
          <Text
            variant="title"
            fontWeight="$regular"
            color="$colorMuted"
            textAlign="center"
            maxWidth="$sheetWidth"
          >
            {section.description}
          </Text>
        </Stack>
      </Reveal>
      <div
        ref={ref}
        className={visible ? "landing-handoff is-visible" : "landing-handoff"}
      >
        {wide ? <WideStage copy={section} /> : <CompactStage copy={section} />}
      </div>
    </Stack>
  );
}
