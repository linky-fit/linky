import {
  Manrope_400Regular,
  Manrope_600SemiBold,
  Manrope_700Bold,
  useFonts,
} from "@expo-google-fonts/manrope";
import {
  CodeBlock,
  ScrollView,
  Stack,
  Text,
  UIProvider,
  Button,
} from "@linky-fit/ui";
import { AppRoot } from "@linky-fit/linky-app/src/boot/AppRoot";
import {
  bootSession,
  type BootedSession,
} from "@linky-fit/linky-app/src/boot/bootSession";
import { getInitialLang, translations } from "@linky-fit/linky-app/src/i18n";
import { makeNativeEvoluPlatform } from "@linky-fit/linky-app/src/platform/evolu.native";
import {
  finishPendingLogout,
  isLogoutPending,
} from "@linky-fit/linky-app/src/platform/logoutWipe";
import { adoptSecretsFromPreviousInstall } from "@linky-fit/linky-app/src/platform/nativeInstall";
import { makeNativePlatformPorts } from "@linky-fit/linky-app/src/platform/nativePorts.native";
import { reloadApp } from "@linky-fit/linky-app/src/platform/reload";
import { formatBootError } from "@linky-fit/linky-app/src/utils/bootDiagnostics";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { useColorScheme } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

void SplashScreen.preventAutoHideAsync();

type BootState =
  | { readonly _tag: "Booting" }
  | { readonly _tag: "Booted"; readonly booted: BootedSession }
  | { readonly _tag: "Failed"; readonly error: unknown };

/** Null when a pending logout was wiped and the app reloads. */
const boot = async (): Promise<BootedSession | null> => {
  // Before anything opens the database or reads the identity being logged out.
  if (isLogoutPending()) {
    await finishPendingLogout();
    reloadApp();
    return null;
  }
  const ports = makeNativePlatformPorts();
  await adoptSecretsFromPreviousInstall(ports);
  return bootSession({ ports, makeEvoluPlatform: makeNativeEvoluPlatform });
};

const hideSplash = () => void SplashScreen.hideAsync();

const BootError = ({ error }: { readonly error: unknown }) => {
  const text = translations[getInitialLang()];
  return (
    <UIProvider mode={useColorScheme() === "dark" ? "dark" : "light"}>
      <ScrollView height="100%">
        <Stack padding="$xxxl">
          <Text variant="heading">{text.appCrashed}</Text>
          <CodeBlock>{formatBootError(error)}</CodeBlock>
          <Button onPress={reloadApp}>{text.reloadApp}</Button>
        </Stack>
      </ScrollView>
    </UIProvider>
  );
};

export const NativeBoot = () => {
  const [fontsLoaded, fontError] = useFonts({
    Manrope_400Regular,
    Manrope_600SemiBold,
    Manrope_700Bold,
  });
  const [state, setState] = useState<BootState>({ _tag: "Booting" });
  useEffect(() => {
    boot().then(
      (booted) => booted && setState({ _tag: "Booted", booted }),
      (error: unknown) => {
        console.error("[linky][boot] failed", error);
        setState({ _tag: "Failed", error });
      },
    );
  }, []);
  useEffect(() => {
    if (state._tag === "Failed") hideSplash();
  }, [state._tag]);

  if (!fontsLoaded && fontError === null) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="auto" />
        {state._tag === "Booted" ? (
          <AppRoot
            registry={state.booted.registry}
            onCommit={hideSplash}
            onError={hideSplash}
          />
        ) : state._tag === "Failed" ? (
          <BootError error={state.error} />
        ) : null}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
};
