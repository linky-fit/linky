// Imported first by main.native.tsx, in this order: later modules use the
// globals the earlier ones install.
import "./installCrypto.native";
import "expo-sqlite/localStorage/install";
import "@linky-fit/linky-app/src/platform/browserPolyfills";
import "@linky-fit/linky-app/src/boot/nodeGlobals";
import "./installWebGlobals.native";
