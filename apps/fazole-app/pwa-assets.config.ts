import {
  defineConfig,
  minimal2023Preset,
} from "@vite-pwa/assets-generator/config";

// The bean is cut out on a transparent background; maskable and Apple icons must be opaque, so they get the brand black behind it.
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
