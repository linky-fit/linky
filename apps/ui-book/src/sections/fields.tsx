import { useState } from "react";
import * as UI from "@linky-fit/ui";
import type { Section } from "../section";
import { options } from "../sample-data";

export const fields: Section = {
  title: "Fields",
  entries: {
    TextField: () => {
      const [name, setName] = useState("Alex Rivers");
      const [note, setNote] = useState("See you on Saturday.");
      const [search, setSearch] = useState("Alex");
      const [address, setAddress] = useState("");
      return (
        <UI.Stack>
          <UI.TextField
            label="Name"
            value={name}
            onChangeText={setName}
            hint="A fictional contact"
          />
          <UI.TextField
            label="Lightning address"
            defaultValue="alex@"
            error="Enter a complete address"
          />
          <UI.TextField label="Read-only example" value="Disabled" disabled />
          <UI.Stack gap="$xs">
            <UI.Row gap="$sm">
              <UI.Stack flex={1}>
                <UI.TextField
                  label="Word 1"
                  hideLabel
                  defaultValue="academic"
                  trailing="1"
                />
              </UI.Stack>
              <UI.Stack flex={1}>
                <UI.TextField
                  label="Word 2"
                  hideLabel
                  defaultValue="acadmic"
                  invalid
                  trailing="2"
                />
              </UI.Stack>
            </UI.Row>
            <UI.Text variant="caption" color="$warningText">
              Unknown word: acadmic
            </UI.Text>
          </UI.Stack>
          <UI.TextField
            label="Note"
            multiline
            value={note}
            onChangeText={setNote}
            trailing={
              <UI.IconButton
                icon="Send"
                variant="primary"
                size="sm"
                accessibilityLabel="Send note"
                disabled={note.trim() === ""}
                onPress={() => setNote("")}
              />
            }
          />
          <UI.TextField
            label="Search contacts"
            hideLabel
            placeholder="Search contacts"
            value={search}
            onChangeText={setSearch}
            trailing={
              search ? (
                <UI.IconButton
                  icon="X"
                  variant="secondary"
                  size="sm"
                  accessibilityLabel="Clear search"
                  onPress={() => setSearch("")}
                />
              ) : null
            }
          />
          <UI.TextField
            label="Contact or lightning address"
            placeholder="npub or name@domain"
            value={address}
            onChangeText={setAddress}
            trailing={
              <UI.IconButton
                icon="ClipboardPaste"
                size="sm"
                accessibilityLabel="Paste"
                onPress={() => setAddress("alex@example.com")}
              />
            }
          />
          <UI.TextField
            label="Amount"
            inputMode="decimal"
            defaultValue="250"
            trailing="CZK"
          />
        </UI.Stack>
      );
    },
    SelectField: () => {
      const [currency, setCurrency] = useState("sats");
      return (
        <UI.SelectField
          label="Currency"
          options={options}
          value={currency}
          onValueChange={setCurrency}
        />
      );
    },
    RichTextInput: () => {
      const [text, setText] = useState("");
      return (
        <UI.RichTextInput
          placeholder="Write with inline @entities"
          empty={text === ""}
          onInput={(event) => setText(event.currentTarget.textContent ?? "")}
          native={{
            segments: text
              .split(/(@\w+)/u)
              .map((part) => ({ text: part, entity: part.startsWith("@") })),
            onChangeText: setText,
          }}
        />
      );
    },
    Form: () => {
      const [name, setName] = useState("Alex Rivers");
      return (
        <UI.Form onSubmit={() => {}}>
          <UI.TextField label="Name" value={name} onChangeText={setName} />
          <UI.SubmitButton>Save</UI.SubmitButton>
        </UI.Form>
      );
    },
    SubmitButton: () => {
      const [submitted, setSubmitted] = useState(0);
      return (
        <UI.Form onSubmit={() => setSubmitted(submitted + 1)}>
          <UI.SubmitButton variant="secondary" icon="Save">
            {`Submitted ${submitted} times`}
          </UI.SubmitButton>
        </UI.Form>
      );
    },
  },
};
