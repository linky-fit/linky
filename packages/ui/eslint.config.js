import config from "@linky/config/eslint";

export default [
  ...config,
  { ignores: [".expo/**", "dist-native/**"] },
  { rules: { "react-refresh/only-export-components": "off" } },
];
