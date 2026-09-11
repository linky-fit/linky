import { useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  Text as NativeText,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { useFonts } from "expo-font";
import { StatusBar } from "expo-status-bar";
import {
  UIProvider,
  Button,
  EmptyState,
  Icon,
  IconButton,
  Row,
  SearchField,
  SegmentedControl,
  Stack,
  Text,
  themes,
  Toast,
} from "@linky/ui";
import type { ColorMode } from "@linky/ui";
import {
  Attachments,
  ChatExample,
  Controls,
  ExampleFrame,
  Feedback,
  Fields,
  Foundations,
  Messaging,
  Navigation,
  Payments,
  People,
  WalletExample,
} from "./examples";
import { fonts } from "./assets";
import { sections } from "./sections";

export function App() {
  const [loaded, error] = useFonts(fonts);
  return (
    <SafeAreaProvider>
      {loaded ? (
        <Catalog />
      ) : (
        <SafeAreaView style={styles.loading}>
          {error ? (
            <NativeText accessibilityRole="alert">
              Could not load the catalog fonts. Restart the preview to try
              again.
            </NativeText>
          ) : (
            <ActivityIndicator accessibilityLabel="Loading catalog" />
          )}
        </SafeAreaView>
      )}
    </SafeAreaProvider>
  );
}

function Catalog() {
  const [mode, setMode] = useState<ColorMode>("dark");
  const [selected, setSelected] = useState("compositions");
  const [query, setQuery] = useState("");
  const [width, setWidth] = useState("comfortable");
  const [notification, setNotification] = useState("");
  const { width: windowWidth } = useWindowDimensions();
  const compact = windowWidth < 700;
  const narrow = width === "narrow";
  const content = useRef<ScrollView>(null);
  const current =
    sections.find((section) => section.id === selected) ?? sections[0];
  const matches = sections.filter((section) =>
    `${section.title} ${section.exports}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const colors = themes[mode];
  const chooseSection = (id: string) => {
    setSelected(id);
    content.current?.scrollTo({ y: 0, animated: false });
  };

  return (
    <UIProvider mode={mode}>
      <SafeAreaView
        testID="book"
        style={[styles.shell, { backgroundColor: colors.background }]}
      >
        <StatusBar style={mode === "dark" ? "light" : "dark"} />
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={[styles.flex, !compact && styles.horizontal]}>
            <View
              style={[
                styles.sidebar,
                compact ? styles.compactSidebar : styles.wideSidebar,
                { borderColor: colors.borderColor },
              ]}
            >
              <Row>
                <Icon name="Wallet" color="$accent" size={26} />
                <Text variant="title">Linky</Text>
                <Text variant="caption" muted marginLeft="auto">
                  UI next
                </Text>
              </Row>
              <SearchField
                label="Find a component"
                placeholder="Find a component…"
                clearLabel="Clear component search"
                value={query}
                onChangeText={setQuery}
              />
              <ScrollView
                horizontal={compact}
                style={!compact && styles.flex}
                contentContainerStyle={{ gap: 5 }}
                keyboardShouldPersistTaps="handled"
                testID="component-groups"
                accessibilityLabel="Component groups"
              >
                {matches.map((section) => (
                  <Pressable
                    key={section.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: selected === section.id }}
                    onPress={() => chooseSection(section.id)}
                    style={({ pressed }) => [
                      styles.navLink,
                      {
                        backgroundColor:
                          selected === section.id
                            ? colors.accentSoft
                            : pressed
                              ? colors.surface
                              : "transparent",
                      },
                    ]}
                  >
                    <Text
                      variant="label"
                      color={selected === section.id ? "$accent" : "$muted"}
                    >
                      {section.title}
                    </Text>
                    <Icon name="ChevronRight" size={14} color="$muted" />
                  </Pressable>
                ))}
                {matches.length === 0 && (
                  <Text variant="caption" muted>
                    No matching components.
                  </Text>
                )}
              </ScrollView>
              {!compact && (
                <Stack gap="$sm" padding="$sm">
                  <Text variant="caption" muted>
                    Built with @linky/ui
                  </Text>
                  <Text variant="caption" muted>
                    Tamagui · Manrope
                  </Text>
                  <Text variant="caption" muted>
                    Fictional sample data. No services.
                  </Text>
                </Stack>
              )}
            </View>
            <ScrollView
              ref={content}
              style={styles.flex}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              contentContainerStyle={styles.mainContent}
            >
              <Row
                padding={compact ? "$md" : "$lg"}
                flexWrap="wrap"
                justifyContent="space-between"
                borderBottomWidth={1}
                borderColor="$borderColor"
              >
                {!compact && (
                  <Text variant="label" muted>
                    Component library
                  </Text>
                )}
                <Row
                  flex={compact ? 1 : undefined}
                  justifyContent="space-between"
                  gap="$sm"
                >
                  <Stack flex={1}>
                    <SegmentedControl
                      label="Preview width"
                      value={width}
                      onValueChange={setWidth}
                      options={[
                        { value: "comfortable", label: "Comfortable" },
                        { value: "narrow", label: "Narrow · 320px" },
                      ]}
                    />
                  </Stack>
                  <IconButton
                    icon={mode === "dark" ? "Sun" : "Moon"}
                    label={
                      mode === "dark"
                        ? "Switch to light theme"
                        : "Switch to dark theme"
                    }
                    onPress={() => setMode(mode === "dark" ? "light" : "dark")}
                  />
                </Row>
              </Row>
              <Stack
                padding={compact ? "$md" : "$xl"}
                gap="$xl"
                width="100%"
                maxWidth={1240}
                alignSelf="center"
              >
                <Stack gap="$md">
                  <Text role="heading" variant="heading">
                    {current.title}
                  </Text>
                  <Text muted>{current.description}</Text>
                </Stack>
                <Text variant="caption" muted>
                  Interactive examples · fictional people and payments
                </Text>
                {query && matches.length === 0 ? (
                  <EmptyState
                    title="No components found"
                    description="Try searching for a component name, such as Button or Dialog."
                    icon="Search"
                    action={
                      <Button onPress={() => setQuery("")}>Clear search</Button>
                    }
                  />
                ) : selected === "compositions" ? (
                  <View
                    style={[
                      styles.compositions,
                      windowWidth >= 1180 && styles.horizontal,
                    ]}
                  >
                    <Stack
                      flex={windowWidth >= 1180 ? 1 : undefined}
                      maxWidth={
                        narrow ? 320 : windowWidth < 1180 ? 460 : undefined
                      }
                      width="100%"
                    >
                      <Text role="heading" variant="caption" muted>
                        Wallet
                      </Text>
                      <ExampleFrame>
                        <WalletExample notify={setNotification} />
                      </ExampleFrame>
                    </Stack>
                    <Stack
                      flex={windowWidth >= 1180 ? 1 : undefined}
                      maxWidth={
                        narrow ? 320 : windowWidth < 1180 ? 460 : undefined
                      }
                      width="100%"
                    >
                      <Text role="heading" variant="caption" muted>
                        Conversation
                      </Text>
                      <ExampleFrame>
                        <ChatExample notify={setNotification} />
                      </ExampleFrame>
                    </Stack>
                  </View>
                ) : (
                  <Stack maxWidth={narrow ? 320 : 750} width="100%">
                    <ExampleFrame>
                      <Stack padding={narrow ? "$sm" : compact ? "$md" : "$lg"}>
                        {selected === "foundations" && <Foundations />}
                        {selected === "controls" && (
                          <Controls notify={setNotification} />
                        )}
                        {selected === "fields" && <Fields />}
                        {selected === "people" && (
                          <People notify={setNotification} />
                        )}
                        {selected === "messaging" && (
                          <Messaging notify={setNotification} />
                        )}
                        {selected === "attachments" && (
                          <Attachments notify={setNotification} />
                        )}
                        {selected === "navigation" && (
                          <Navigation notify={setNotification} />
                        )}
                        {selected === "feedback" && (
                          <Feedback notify={setNotification} />
                        )}
                        {selected === "payments" && <Payments />}
                      </Stack>
                    </ExampleFrame>
                  </Stack>
                )}
                <Stack
                  paddingTop="$xl"
                  borderTopWidth={1}
                  borderColor="$borderColor"
                >
                  <Text role="heading" variant="label">
                    Use these components
                  </Text>
                  <Text variant="caption" muted>
                    {current.exports}
                  </Text>
                  <Stack
                    padding="$lg"
                    backgroundColor="$surface"
                    borderRadius="$control"
                  >
                    <NativeText
                      selectable
                      style={{
                        color: colors.color,
                        fontFamily:
                          Platform.OS === "ios" ? "Menlo" : "monospace",
                        fontSize: 12,
                        lineHeight: 22,
                      }}
                    >
                      {`import { ${Array.from(new Set(Array.from(current.code.matchAll(/<([A-Z]\w*)/g), (match) => match[1]))).join(", ")} } from "@linky/ui";\n\n${current.code}`}
                    </NativeText>
                  </Stack>
                  <Text variant="caption" muted>
                    Examples use local React state. Apps provide translated
                    labels, formatted values, and action handlers. Open the
                    package README for the ownership and platform notes.
                  </Text>
                </Stack>
              </Stack>
            </ScrollView>
          </View>
          {notification && (
            <View style={styles.toast}>
              <Toast
                message={notification}
                dismissLabel="Dismiss notification"
                onDismiss={() => setNotification("")}
              />
            </View>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </UIProvider>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  shell: { flex: 1 },
  loading: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  horizontal: { flexDirection: "row" },
  sidebar: { gap: 24 },
  wideSidebar: { width: 258, padding: 20, paddingTop: 30, borderRightWidth: 1 },
  compactSidebar: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    gap: 12,
    borderBottomWidth: 1,
  },
  navLink: {
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
  },
  mainContent: { paddingBottom: 48 },
  compositions: { gap: 30, alignItems: "flex-start" },
  toast: {
    position: "absolute",
    right: 16,
    bottom: 16,
    left: 16,
    maxWidth: 440,
    marginLeft: "auto",
    zIndex: 1000,
  },
});
