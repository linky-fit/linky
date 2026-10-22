import { useState } from "react";
import * as UI from "@linky-fit/ui";
import type { Section } from "../section";
import { options } from "../sample-data";

export const controls: Section = {
  title: "Controls",
  entries: {
    Button: () => (
      <UI.Row flexWrap="wrap">
        <UI.Button icon="Send">Primary</UI.Button>
        <UI.Button variant="secondary">Secondary</UI.Button>
        <UI.Button variant="ghost" size="sm">
          Ghost / small
        </UI.Button>
        <UI.Button variant="accent" size="sm">
          Accent / small
        </UI.Button>
        <UI.Button variant="danger">Danger</UI.Button>
        <UI.Button disabled tooltip="Shown on hover on the web">
          Disabled with tooltip
        </UI.Button>
        <UI.Button loading>Loading</UI.Button>
      </UI.Row>
    ),
    IconButton: () => (
      <UI.Row flexWrap="wrap">
        <UI.IconButton
          icon="Plus"
          variant="primary"
          size="sm"
          accessibilityLabel="Small primary"
        />
        <UI.IconButton
          icon="HeartHandshake"
          variant="secondary"
          accessibilityLabel="Medium secondary"
        />
        <UI.IconButton icon="Send" size="lg" accessibilityLabel="Large ghost" />
        <UI.IconButton
          icon="Trash2"
          variant="danger"
          accessibilityLabel="Danger icon"
        />
        <UI.IconButton
          icon="Plus"
          disabled
          accessibilityLabel="Disabled icon"
          tooltip="Disabled icon"
        />
        <UI.IconButton icon="Plus" loading accessibilityLabel="Loading icon" />
        <UI.IconButton
          icon="Bitcoin"
          indicator="warning"
          accessibilityLabel="Pending on-chain transaction"
        />
      </UI.Row>
    ),
    OptionTile: () => {
      const [method, setMethod] = useState("lightning");
      return (
        <UI.Row>
          <UI.OptionTile
            flex={1}
            label="Lightning"
            icon="Zap"
            selected={method === "lightning"}
            onPress={() => setMethod("lightning")}
          />
          <UI.OptionTile
            flex={1}
            label="Ecash"
            icon="Wallet"
            selected={method === "ecash"}
            onPress={() => setMethod("ecash")}
          />
          <UI.OptionTile
            flex={1}
            label="Alex Rivers"
            leading={<UI.Avatar name="Alex Rivers" size="sm" />}
            selected={method === "contact"}
            onPress={() => setMethod("contact")}
          >
            <UI.Text variant="caption" color="$colorMuted" textAlign="center">
              Contact
            </UI.Text>
          </UI.OptionTile>
        </UI.Row>
      );
    },
    Pressable: () => {
      const [pressed, setPressed] = useState(false);
      return (
        <UI.Pressable
          onPress={() => setPressed(!pressed)}
          padding="$md"
          borderRadius="$control"
          backgroundColor="$neutralSoft"
        >
          <UI.Text>{pressed ? "Pressed" : "Press this custom target"}</UI.Text>
        </UI.Pressable>
      );
    },
    Switch: () => {
      const [enabled, setEnabled] = useState(true);
      return (
        <UI.Row>
          <UI.Switch
            accessibilityLabel="Example switch"
            value={enabled}
            onValueChange={setEnabled}
          />
          <UI.Text>{enabled ? "On" : "Off"}</UI.Text>
          <UI.Switch
            accessibilityLabel="Disabled switch"
            value={false}
            onValueChange={setEnabled}
            disabled
          />
        </UI.Row>
      );
    },
    Chip: () => {
      const [chip, setChip] = useState(true);
      return (
        <UI.Row>
          <UI.Chip
            label="Selected"
            selected={chip}
            onPress={() => setChip(!chip)}
          />
          <UI.Chip
            label="Available"
            selected={!chip}
            onPress={() => setChip(!chip)}
          />
          <UI.Chip label="Disabled" disabled onPress={() => setChip(!chip)} />
        </UI.Row>
      );
    },
    SegmentedControl: () => {
      const [segment, setSegment] = useState("sats");
      return (
        <UI.SegmentedControl
          accessibilityLabel="Unit segments"
          options={options}
          value={segment}
          onValueChange={setSegment}
        />
      );
    },
    Stepper: () => {
      const [step, setStep] = useState(2);
      return (
        <UI.Stepper
          accessibilityLabel="Quantity"
          value={step}
          min={1}
          max={5}
          onValueChange={setStep}
          decreaseLabel="Decrease quantity"
          increaseLabel="Increase quantity"
        />
      );
    },
    SliderField: () => {
      const [slider, setSlider] = useState(40);
      return (
        <UI.Stack>
          <UI.SliderField
            label={`Limit · ${slider}`}
            value={slider}
            min={0}
            max={100}
            onValueChange={setSlider}
          />
          <UI.SliderField
            label="Disabled limit"
            value={25}
            min={0}
            max={100}
            disabled
            onValueChange={setSlider}
          />
        </UI.Stack>
      );
    },
  },
};
