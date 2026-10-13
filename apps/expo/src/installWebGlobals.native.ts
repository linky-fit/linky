import { makeReloadableSessionStorage } from "@linky-fit/linky-app/src/platform/reloadableSessionStorage";
import { makeSingleContextLocks } from "@linky-fit/linky-app/src/platform/singleContextLocks";
import { localStorageKv } from "@linky-fit/linky-app/src/utils/storage";

Object.defineProperty(globalThis, "sessionStorage", {
  configurable: true,
  value: makeReloadableSessionStorage(localStorageKv),
});

// Wallet and storage writes run only under a Web Lock.
Object.defineProperty(navigator, "locks", {
  configurable: true,
  value: makeSingleContextLocks(),
});

// Hermes' Intl knows the device locale; browserPreferences and formatting read it from navigator.
const deviceLocale = new Intl.DateTimeFormat().resolvedOptions().locale;
Object.defineProperties(navigator, {
  language: { configurable: true, value: deviceLocale },
  languages: { configurable: true, value: [deviceLocale] },
});
