import {
  Row,
  SupporterBadge,
  Text,
  type SupporterBadgeKind,
} from "@linky-fit/ui";
import React from "react";
import type { I18nKey, Translate } from "../i18n";

const SUPPORTER_LINE_KEYS = {
  bronze: "supporterLineBronze",
  silver: "supporterLineSilver",
  gold: "supporterLineGold",
  diamond: "supporterLineDiamond",
  generic: "supporterLineGeneric",
} as const satisfies Record<SupporterBadgeKind, I18nKey>;

interface SupporterLineProps {
  kind: SupporterBadgeKind | undefined;
  t: Translate;
}

/** The line under a profile name that says which supporter badge it shows. */
export function SupporterLine({
  kind,
  t,
}: SupporterLineProps): React.ReactElement | null {
  if (!kind) return null;
  return (
    <Row gap="$xs" justifyContent="center">
      <SupporterBadge kind={kind} size="iconSm" />
      <Text variant="label" color="$colorMuted">
        {t(SUPPORTER_LINE_KEYS[kind])}
      </Text>
    </Row>
  );
}
