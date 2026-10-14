import * as UI from "@linky-fit/ui";
import type { Section } from "../section";

export const setup: Section = {
  title: "Setup",
  entries: {
    UIProvider: ({ mode }) => (
      <UI.Text>
        Provides the {mode} theme, fonts and animations;
        brand=&quot;fazole&quot; switches to the fazole palette.
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
