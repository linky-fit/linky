import config from "@linky/config/eslint";
export default [
  ...config,
  {
    ignores: [
      ".expo/**",
      "ios/**",
      "android/**",
      "dist/**",
      "test-results/**",
      "playwright-report/**",
    ],
  },
];
