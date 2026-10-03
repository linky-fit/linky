import * as UI from "@linky-fit/ui";
import type { Section } from "../section";
import { sampleImage } from "../sample-image";

export const layout: Section = {
  title: "Layout and type",
  entries: {
    Screen: () => (
      <UI.Screen>
        <UI.Text>Page gutter and background</UI.Text>
      </UI.Screen>
    ),
    Stack: () => (
      <UI.Stack>
        <UI.Text>First</UI.Text>
        <UI.Text>Second</UI.Text>
      </UI.Stack>
    ),
    Row: () => (
      <UI.Row>
        <UI.Pill label="First" size="sm" />
        <UI.Pill label="Second" size="sm" />
      </UI.Row>
    ),
    Card: () => (
      <UI.Stack>
        <UI.Card>
          <UI.Text>Default card</UI.Text>
        </UI.Card>
        <UI.Card outlined>
          <UI.Text>Outlined card</UI.Text>
        </UI.Card>
        <UI.Card elevated>
          <UI.Text>Elevated card</UI.Text>
        </UI.Card>
      </UI.Stack>
    ),
    Section: () => (
      <UI.Section title="A section">
        <UI.Text>Related content</UI.Text>
      </UI.Section>
    ),
    Divider: () => (
      <UI.Stack>
        <UI.Text>Above</UI.Text>
        <UI.Divider />
        <UI.Text>Below</UI.Text>
      </UI.Stack>
    ),
    Text: () => (
      <UI.Stack>
        {(
          [
            "caption",
            "label",
            "body",
            "title",
            "heading",
            "display",
            "amount",
          ] satisfies UI.TextVariant[]
        ).map((variant) => (
          <UI.Text key={variant} variant={variant}>
            {variant}
          </UI.Text>
        ))}
        <UI.Text bold>Bold</UI.Text>
        <UI.Text mono>Monospace</UI.Text>
        <UI.Text eyebrow>Eyebrow</UI.Text>
      </UI.Stack>
    ),
    ScrollView: () => (
      <UI.ScrollView horizontal>
        <UI.Row>
          {["One", "Two", "Three", "Four", "Five", "Six"].map((label) => (
            <UI.Card key={label}>
              <UI.Text>{label}</UI.Text>
            </UI.Card>
          ))}
        </UI.Row>
      </UI.ScrollView>
    ),
    ScrollList: () => (
      <UI.Stack height="$column">
        <UI.ScrollList>
          {["Relays", "Mints", "Contacts", "Backup", "Language", "About"].map(
            (title) => (
              <UI.ListRow key={title} title={title} onPress={() => {}} />
            ),
          )}
        </UI.ScrollList>
      </UI.Stack>
    ),
    Image: () => (
      <UI.Image
        src={sampleImage}
        width="$hero"
        height="$hero"
        borderRadius="$card"
        aria-label="Color study"
      />
    ),
    Spacer: () => (
      <UI.Row>
        <UI.Text>Start</UI.Text>
        <UI.Spacer flex={1} />
        <UI.Text>End</UI.Text>
      </UI.Row>
    ),
    Icon: () => (
      <UI.Stack gap="$lg">
        <UI.Row flexWrap="wrap">
          {(["sm", "md", "lg", "xl"] satisfies UI.IconSize[]).map((size) => (
            <UI.Stack key={size} gap="$xs" alignItems="center">
              <UI.Icon name="Send" size={size} />
              <UI.Text variant="caption">{size}</UI.Text>
            </UI.Stack>
          ))}
        </UI.Row>
        <UI.Row flexWrap="wrap" gap="$md">
          {Object.keys(UI.icons)
            .filter((name): name is UI.IconName => name in UI.icons)
            .map((name) => (
              <UI.Stack key={name} gap="$xs" alignItems="center">
                <UI.Icon name={name} />
                <UI.Text variant="caption" color="$colorMuted">
                  {name}
                </UI.Text>
              </UI.Stack>
            ))}
        </UI.Row>
      </UI.Stack>
    ),
    BrandMark: () => (
      <UI.Row>
        <UI.BrandMark size="controlLg" />
        <UI.BrandMark />
      </UI.Row>
    ),
    BrandHero: () => (
      <UI.Stack paddingVertical="$huge">
        <UI.BrandHero />
      </UI.Stack>
    ),
  },
};
