import {
  defineConfig,
  minimal2023Preset,
} from "@vite-pwa/assets-generator/config";

// The bean tile's black, so maskable and Apple icons bleed into it seamlessly.
const tile = { padding: 0, resizeOptions: { background: "#000000" } };

export default defineConfig({
  headLinkOptions: { preset: "2023" },
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, ...tile },
    apple: { ...minimal2023Preset.apple, ...tile },
  },
  images: ["public/logo.webp"],
});
