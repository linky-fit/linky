// Tests assert the Czech copy, so they run as on a Czech device.
Object.defineProperty(navigator, "language", {
  value: "cs-CZ",
  configurable: true,
});
