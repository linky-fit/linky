import { useState } from "react";
import * as UI from "@linky-fit/ui";
import type { Section } from "../section";

export const payments: Section = {
  title: "Payments",
  entries: {
    Amount: () => (
      <UI.Stack>
        <UI.Amount value="1 250" unit="Kč" size="xl" caption="Terminal" />
        <UI.Amount value="2,400" unit="sats" caption="Balance" />
        <UI.Amount value="120" unit="sats" size="md" caption="Small amount" />
      </UI.Stack>
    ),
    Keypad: () => {
      const [amount, setAmount] = useState("0");
      return (
        <UI.Stack>
          <UI.Text variant="display" textAlign="center">
            {amount}
          </UI.Text>
          <UI.Keypad
            accessibilityLabel="Example keypad"
            labels={{ clear: "Clear", decimal: ".", delete: "Delete digit" }}
            onKeyPress={(key) =>
              setAmount((current) =>
                key === "C"
                  ? "0"
                  : key === "⌫"
                    ? current.slice(0, -1) || "0"
                    : (current === "0" ? key : current + key).slice(0, 8),
              )
            }
          />
        </UI.Stack>
      );
    },
    QRCode: () => (
      <UI.Row flexWrap="wrap">
        <UI.QRCode
          value="https://example.com/ui-book"
          accessibilityLabel="Example QR code"
        />
        <UI.QRCode
          value="https://example.com/ui-book"
          accessibilityLabel="Example QR code to copy"
          badge="Copy"
          tooltip="Copy"
          onPress={() => {}}
        />
      </UI.Row>
    ),
  },
};
