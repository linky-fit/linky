import { useState } from "react";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useBookFonts } from "./fonts";
import * as UI from "@linky-fit/ui";
import { componentSections, tokens } from "./sections";

type Look = UI.ColorMode | "fazole";

const looks = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "fazole", label: "fazole" },
] as const satisfies readonly UI.SegmentedOption<Look>[];

export default function App() {
  const [look, setLook] = useState<Look>("light");
  const [loaded, error] = useBookFonts();
  const mode = look === "fazole" ? "dark" : look;
  const page = (
    <>
      <StatusBar style={mode === "dark" ? "light" : "dark"} />
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor:
            UI.themes[look === "fazole" ? "dark_fazole" : look].background,
        }}
      >
        {error ? (
          <UI.Text>Could not load Manrope: {error.message}</UI.Text>
        ) : loaded ? (
          <Book look={look} mode={mode} onLookChange={setLook} />
        ) : (
          <UI.LoadingState label="Loading fonts" />
        )}
      </SafeAreaView>
    </>
  );
  return (
    <SafeAreaProvider>
      {look === "fazole" ? (
        <UI.UIProvider mode="dark" brand="fazole">
          {page}
        </UI.UIProvider>
      ) : (
        <UI.UIProvider mode={mode}>{page}</UI.UIProvider>
      )}
    </SafeAreaProvider>
  );
}

function Book({
  look,
  mode,
  onLookChange,
}: {
  look: Look;
  mode: UI.ColorMode;
  onLookChange: (look: Look) => void;
}) {
  return (
    <UI.ScrollView flex={1} keyboardShouldPersistTaps="handled">
      <UI.Screen
        width="100%"
        maxWidth="$contentWidth"
        alignSelf="center"
        gap="$xxxl"
      >
        <UI.Stack gap="$md">
          <UI.Text variant="heading" role="heading">
            Linky UI book
          </UI.Text>
          <UI.SegmentedControl
            accessibilityLabel="Theme"
            value={look}
            options={looks}
            onValueChange={onLookChange}
          />
          <UI.Text color="$colorMuted">
            Every element, grouped by category. Fictional data, local state.
          </UI.Text>
          <UI.Text variant="caption" color="$colorMuted">
            {looks.find((option) => option.value === look)?.label} theme ·{" "}
            {componentSections.reduce(
              (count, section) => count + Object.keys(section.entries).length,
              0,
            )}{" "}
            components
          </UI.Text>
        </UI.Stack>
        {[tokens, ...componentSections].map((section) => (
          <UI.Stack
            key={section.title}
            gap="$xl"
            testID={`category-${section.title}`}
          >
            <UI.Text variant="heading" role="heading">
              {section.title}
            </UI.Text>
            {Object.entries(section.entries).map(([name, Example]) => (
              <UI.Stack key={name} gap="$md" testID={`entry-${name}`}>
                <UI.Text variant="label" role="heading" color="$colorMuted">
                  {name}
                </UI.Text>
                <Example mode={mode} />
                <UI.Divider marginTop="$sm" />
              </UI.Stack>
            ))}
          </UI.Stack>
        ))}
      </UI.Screen>
    </UI.ScrollView>
  );
}
