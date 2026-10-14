// Node loads this file as native ESM: expo has no exports map to resolve a bare subpath,
// and Node 22 sees only some named exports of this CommonJS module.
import configPlugins, { type ConfigPlugin } from "expo/config-plugins.js";

const { AndroidConfig, withAndroidManifest, withInfoPlist } = configPlugins;

const localNetworkUsage =
  "Linky connects to development services on your local network.";

interface LocalNetworking {
  /** Android release builds may use http:// and ws:// (debug builds always may). */
  readonly cleartext: boolean;
  /** iOS may reach hosts on the local network, which asks the user once. */
  readonly localNetwork: boolean;
}

/**
 * Opens the transport exceptions a build against the local stack needs and
 * removes the ones expo-dev-client adds when it doesn't, so an app talking to
 * production services keeps strict ATS and no local network prompt.
 */
export const withLocalNetworking: ConfigPlugin<LocalNetworking> = (
  config,
  { cleartext, localNetwork },
) =>
  withInfoPlist(
    withAndroidManifest(config, (manifest) => {
      if (cleartext)
        AndroidConfig.Manifest.getMainApplicationOrThrow(manifest.modResults).$[
          "android:usesCleartextTraffic"
        ] = "true";
      return manifest;
    }),
    (plist) => {
      if (localNetwork) {
        plist.modResults["NSLocalNetworkUsageDescription"] = localNetworkUsage;
        plist.modResults["NSAppTransportSecurity"] = {
          NSAllowsArbitraryLoads: false,
          NSAllowsLocalNetworking: true,
        };
      } else {
        delete plist.modResults["NSLocalNetworkUsageDescription"];
        delete plist.modResults["NSBonjourServices"];
        delete plist.modResults["NSAppTransportSecurity"];
      }
      return plist;
    },
  );
