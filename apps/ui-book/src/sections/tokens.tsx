import { View } from "react-native";
import * as UI from "@linky-fit/ui";
import type { Section } from "../section";

const lineHeight = (token: string) =>
  Object.entries(UI.typography.lineHeight).find(([key]) => key === token)?.[1];

const paletteHighlights = [
  "background",
  "surface",
  "color",
  "accent",
  "accentSoft",
] as const satisfies (keyof UI.ThemeColors)[];

const swatch = (color: string, border: string) => ({
  backgroundColor: color,
  width: UI.size.control,
  height: UI.size.controlSm,
  borderRadius: UI.radius.sm,
  borderWidth: UI.border.hairline,
  borderColor: border,
});

export const tokens: Section = {
  title: "Tokens",
  entries: {
    "Token scales": ({ mode, palette }) => (
      <UI.Stack gap="$xxl">
        <UI.Stack gap="$sm">
          <UI.Text variant="label">Palettes in {mode} mode</UI.Text>
          {UI.THEME_PALETTES.map((name) => (
            <UI.Row key={name} gap="$sm">
              {paletteHighlights.map((token) => (
                <View
                  key={token}
                  style={swatch(
                    UI.palettes[name][mode][token],
                    UI.palettes[palette][mode].borderColor,
                  )}
                />
              ))}
              <UI.Text variant="caption" bold>
                {name}
              </UI.Text>
            </UI.Row>
          ))}
        </UI.Stack>
        {UI.COLOR_MODES.map((colorMode) => (
          <UI.Stack key={colorMode} gap="$sm">
            <UI.Text variant="label">
              {palette} {colorMode} colors
            </UI.Text>
            {Object.entries(UI.palettes[palette][colorMode]).map(
              ([token, color]) => (
                <UI.Row key={token} gap="$sm">
                  <View
                    style={swatch(
                      color,
                      UI.palettes[palette][mode].borderColor,
                    )}
                  />
                  <UI.Stack flex={1} gap="$none">
                    <UI.Text variant="caption" bold>
                      {token}
                    </UI.Text>
                    <UI.Text variant="caption" mono color="$colorMuted">
                      {color}
                    </UI.Text>
                  </UI.Stack>
                </UI.Row>
              ),
            )}
          </UI.Stack>
        ))}
        <UI.Stack gap="$sm">
          <UI.Text variant="label">Supporter badge colors</UI.Text>
          {UI.SUPPORTER_BADGE_KINDS.map((kind) => (
            <UI.Row key={kind} gap="$sm">
              {Object.values(UI.supporterBadgeColors[kind]).map((color) => (
                <View
                  key={color}
                  style={swatch(color, UI.palettes[palette][mode].borderColor)}
                />
              ))}
              <UI.Text variant="caption" bold>
                {kind}
              </UI.Text>
            </UI.Row>
          ))}
        </UI.Stack>
        {Object.entries({
          space: UI.space,
          radius: UI.radius,
          size: UI.size,
        }).map(([scale, values]) => (
          <UI.Stack key={scale} gap="$sm">
            <UI.Text variant="label">{scale}</UI.Text>
            {Object.entries(values).map(([token, value]) => (
              <UI.Stack key={token} gap="$xs">
                <UI.Text variant="caption" color="$colorMuted">
                  {token} · {value}
                </UI.Text>
                {scale === "radius" ? (
                  <UI.Stack
                    width="$controlLg"
                    height="$controlSm"
                    borderRadius={value}
                    backgroundColor="$accentSoft"
                    borderWidth={UI.border.hairline}
                    borderColor="$accent"
                  />
                ) : (
                  <UI.Stack
                    width={value}
                    maxWidth="100%"
                    height="$track"
                    backgroundColor="$accent"
                    borderRadius="$pill"
                  />
                )}
              </UI.Stack>
            ))}
          </UI.Stack>
        ))}
        <UI.Stack gap="$sm">
          <UI.Text variant="label">Font sizes / line heights</UI.Text>
          {Object.entries(UI.typography.size).map(([token, value]) => (
            <UI.Row key={token} flexWrap="wrap" alignItems="baseline">
              <UI.Text fontSize={value} lineHeight={lineHeight(token)}>
                {token}
              </UI.Text>
              <UI.Text variant="caption" color="$colorMuted">
                {value} / {lineHeight(token)}
              </UI.Text>
            </UI.Row>
          ))}
        </UI.Stack>
        {Object.entries({
          fontFamily: UI.fontFamily,
          fontWeight: UI.fontWeight,
          letterSpacing: UI.letterSpacing,
          border: UI.border,
          opacity: UI.opacity,
          duration: UI.duration,
          easing: UI.easing,
          enterScale: UI.enterScale,
          zIndex: UI.zIndex,
          breakpoint: UI.breakpoint,
          shadow: UI.shadow,
        }).map(([scale, values]) => (
          <UI.Stack key={scale} gap="$xs">
            <UI.Text variant="label">{scale}</UI.Text>
            {Object.entries(values).map(([token, value]) => (
              <UI.Text key={token} variant="caption" mono>
                {token} · {value}
              </UI.Text>
            ))}
          </UI.Stack>
        ))}
      </UI.Stack>
    ),
  },
};
