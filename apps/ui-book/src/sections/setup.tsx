import * as UI from "@linky-fit/ui";
import type { Section } from "../section";

export const setup: Section = {
  title: "Setup",
  entries: {
    UIProvider: ({ mode, palette }) => (
      <UI.Text>
        Provides the {palette} palette in {mode} mode, fonts and animations.
      </UI.Text>
    ),
    Theme: ({ mode }) => (
      <UI.Theme name={mode === "light" ? "dark" : "light"}>
        <UI.Card>
          <UI.Text>The opposite theme, nested.</UI.Text>
        </UI.Card>
      </UI.Theme>
    ),
  },
};
