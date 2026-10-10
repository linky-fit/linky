import { builtinRules } from "eslint/use-at-your-own-risk";

const browserGlobals = [
  "window",
  "document",
  "navigator",
  "location",
  "history",
  "indexedDB",
  "self",
];

// Core rules under their own names, so the seam's ignore list leaves the config's other restrictions in force.
export const platformSeamPlugin = {
  rules: {
    globals: builtinRules.get("no-restricted-globals"),
    properties: builtinRules.get("no-restricted-properties"),
    syntax: builtinRules.get("no-restricted-syntax"),
  },
};

/** Bans browser globals, `globalThis.<global>` and `import.meta.env`; register `platformSeamPlugin` as `platform-seam`. */
export const platformSeamRules = (/** @type {string} */ message) => ({
  "platform-seam/globals": [
    "error",
    ...browserGlobals.map((name) => ({ name, message })),
  ],
  "platform-seam/properties": [
    "error",
    ...browserGlobals.map((property) => ({
      object: "globalThis",
      property,
      message,
    })),
  ],
  "platform-seam/syntax": [
    "error",
    {
      selector:
        "MemberExpression[object.type='MetaProperty'][object.meta.name='import'][property.name='env']",
      message: `'import.meta.env' is restricted from being used. ${message}`,
    },
  ],
});
