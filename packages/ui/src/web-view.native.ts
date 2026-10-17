import type { ComponentProps } from "react";
import { Linking } from "react-native";
import type { WebView } from "react-native-webview";

export type ShouldStartLoadRequest = Parameters<
  NonNullable<ComponentProps<typeof WebView>["onShouldStartLoadWithRequest"]>
>[0];

const EXTERNAL = /^(https?|mailto|tel|sms):/i;

/** Hands a link the user followed inside a web view to the browser or the app that handles it. */
export const openLinkOutside = (url: string): void => {
  if (EXTERNAL.test(url)) void Linking.openURL(url);
};
