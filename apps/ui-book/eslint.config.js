import config from "@linky/config/eslint";
export default [
  ...config,
  { ignores: ["dist/**", "test-results/**", "playwright-report/**"] },
];
