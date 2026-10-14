// Node loads this file as native ESM: expo has no exports map to resolve a bare subpath,
// and Node 22 sees only some named exports of this CommonJS module.
import configPlugins, { type ConfigPlugin } from "expo/config-plugins.js";

const { withAppDelegate, withInfoPlist } = configPlugins;

const templateClass = "class AppDelegate: ExpoAppDelegate {";
const sceneClass =
  "class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {";

const templateStart = `#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif
`;

const replaceOnce = (source: string, from: string, to: string): string => {
  if (!source.includes(from))
    throw new Error(
      `withSceneLifecycle: AppDelegate.swift no longer contains:\n${from}`,
    );
  return source.replace(from, to);
};

/**
 * iOS 27 stops an app at launch unless it adopts the scene life cycle.
 * Expo's ExpoAppSceneDelegate creates the window and starts React Native
 * from the factory the app delegate provides, so the app delegate no longer
 * starts it itself.
 */
export const withSceneLifecycle: ConfigPlugin = (config) =>
  withAppDelegate(
    withInfoPlist(config, (plist) => {
      plist.modResults["UIApplicationSceneManifest"] = {
        UIApplicationSupportsMultipleScenes: false,
        UISceneConfigurations: {
          UIWindowSceneSessionRoleApplication: [
            {
              UISceneConfigurationName: "Default Configuration",
              UISceneDelegateClassName: "EXExpoAppSceneDelegate",
            },
          ],
        },
      };
      return plist;
    }),
    (appDelegate) => {
      appDelegate.modResults.contents = replaceOnce(
        replaceOnce(appDelegate.modResults.contents, templateClass, sceneClass),
        templateStart,
        "",
      );
      return appDelegate;
    },
  );
