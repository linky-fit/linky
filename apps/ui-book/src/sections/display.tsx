import { useState } from "react";
import * as UI from "@linky-fit/ui";
import type { Section } from "../section";
import { sampleImage } from "../sample-image";
import { tones } from "../sample-data";

const avatarSizes = ["xs", "sm", "md", "lg"] satisfies UI.AvatarSize[];

export const display: Section = {
  title: "Display",
  entries: {
    Avatar: () => (
      <UI.Row flexWrap="wrap">
        {avatarSizes.map((size) => (
          <UI.Avatar
            key={size}
            name="Alex Rivers"
            size={size}
            indicator="accent"
          />
        ))}
        <UI.Avatar name="Color study" uri={sampleImage} />
        <UI.Avatar name="Alex Rivers" fallback="🦊" />
        <UI.Avatar name="Alex Rivers" raised />
        {UI.SUPPORTER_BADGE_KINDS.map((kind) => (
          <UI.Row key={kind} width="100%" alignItems="flex-end">
            {avatarSizes.map((size) => (
              <UI.Avatar
                key={size}
                name="Alex Rivers"
                uri={sampleImage}
                size={size}
                supporter={kind}
              />
            ))}
            <UI.Text variant="caption" color="$colorMuted">
              {kind}
            </UI.Text>
          </UI.Row>
        ))}
      </UI.Row>
    ),
    SupporterBadge: () => (
      <UI.Row flexWrap="wrap">
        {UI.SUPPORTER_BADGE_KINDS.map((kind) => (
          <UI.SupporterBadge
            key={kind}
            kind={kind}
            accessibilityLabel={`${kind} supporter`}
          />
        ))}
        {UI.SUPPORTER_BADGE_KINDS.map((kind) => (
          <UI.SupporterBadge key={kind} kind={kind} size="iconXl" />
        ))}
      </UI.Row>
    ),
    AvatarGroup: () => (
      <UI.Stack>
        <UI.AvatarGroup
          people={[
            { name: "Alex Rivers" },
            { name: "Color study", uri: sampleImage },
          ]}
        />
        <UI.AvatarGroup
          people={["Alex Rivers", "Bea Stone", "Cyril Novak", "Dana Kral"].map(
            (name) => ({ name }),
          )}
          max={2}
        />
      </UI.Stack>
    ),
    Pill: () => {
      const [pressed, setPressed] = useState(false);
      return (
        <UI.Stack>
          <UI.Pill label="Alex" hint="Contact" />
          <UI.Pill label="Pending" tone="warning" />
          <UI.Pill label="120 sats" size="sm" />
          <UI.Pill
            label={pressed ? "Selected" : "Pressable"}
            tone="info"
            onPress={() => setPressed(!pressed)}
          />
          <UI.Row flexWrap="wrap">
            {tones.map((tone) => (
              <UI.Pill key={tone} label={tone} tone={tone} size="sm" />
            ))}
          </UI.Row>
        </UI.Stack>
      );
    },
    StatusDot: () => (
      <UI.Row flexWrap="wrap">
        {tones.map((tone) => (
          <UI.Row key={tone} gap="$xs">
            <UI.StatusDot tone={tone} accessibilityLabel={tone} />
            <UI.Text variant="caption">{tone}</UI.Text>
          </UI.Row>
        ))}
      </UI.Row>
    ),
    CodeBlock: () => (
      <UI.CodeBlock>fictional-public-key-0123456789</UI.CodeBlock>
    ),
    DataTable: () => (
      <UI.Stack>
        <UI.DataTable
          accessibilityLabel="Fictional balances"
          columns={[
            { key: "mint", label: "Mint" },
            { key: "balance", label: "Balance" },
          ]}
          rows={[
            { key: "a", cells: ["Mint A", "2,400 sats"] },
            { key: "b", cells: ["Mint B", "800 sats"] },
          ]}
        />
        <UI.DataTable
          accessibilityLabel="Fictional balances sharing the width"
          fill
          columns={[
            { key: "mint", label: "Mint", span: 2 },
            { key: "balance", label: "Balance" },
          ]}
          rows={[{ key: "a", cells: ["Mint A", "2,400 sats"] }]}
        />
      </UI.Stack>
    ),
    DataValue: () => (
      <UI.DataValue
        value="fictional-event-id-0123456789abcdef"
        previewLength={12}
      />
    ),
    TimelineRow: () => {
      const [selected, setSelected] = useState(false);
      return (
        <UI.Stack gap="$none">
          <UI.TimelineRow
            time="10:42:07"
            channel="nostr.wire"
            tag="EVENT"
            summary="Gift wrap sent to a fictional relay"
            selected={selected}
            onPress={() => setSelected(!selected)}
          />
          <UI.TimelineRow
            time="10:42:08"
            channel="cashu.mint"
            tag="OK"
            summary="Related answer"
            tone="accent"
            clientLabel="Tab 2"
            related
            onPress={() => setSelected(!selected)}
          />
        </UI.Stack>
      );
    },
    Disclosure: () => (
      <UI.Disclosure title="Show details">
        <UI.Text>Additional information, revealed on press.</UI.Text>
      </UI.Disclosure>
    ),
  },
};
