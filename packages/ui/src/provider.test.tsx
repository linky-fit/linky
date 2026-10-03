import { getVariableValue, Text, useTheme } from "tamagui";
import { describe, expect, it } from "vitest";
import { render } from "../test/render";
import { UIProvider } from "./provider";
import { COLOR_MODES, palettes, THEME_PALETTES } from "./tokens";

function Accent() {
  return <Text>{String(getVariableValue(useTheme().accent))}</Text>;
}

describe("UIProvider", () => {
  it.each(
    THEME_PALETTES.flatMap((palette) =>
      COLOR_MODES.map((mode) => ({ palette, mode })),
    ),
  )("applies the $palette palette in $mode mode", async ({ palette, mode }) => {
    const container = await render(
      <UIProvider mode={mode} palette={palette}>
        <Accent />
      </UIProvider>,
    );
    expect(container.textContent).toBe(palettes[palette][mode].accent);
  });

  it("defaults to the default palette", async () => {
    const container = await render(<Accent />);
    expect(container.textContent).toBe(palettes.default.dark.accent);
  });
});
