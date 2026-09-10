import react from "@vitejs/plugin-react-swc";
import { defineConfig, transformWithEsbuild } from "vite";
const extensions = [
  ".web.mjs",
  ".web.js",
  ".web.jsx",
  ".web.ts",
  ".web.tsx",
  ".mjs",
  ".js",
  ".mts",
  ".ts",
  ".jsx",
  ".tsx",
  ".json",
];
export default defineConfig({
  define: {
    global: "globalThis",
    "process.env": "{}",
    "process.env.TAMAGUI_TARGET": JSON.stringify("web"),
    __DEV__: process.env.NODE_ENV !== "production",
  },
  resolve: {
    extensions,
    dedupe: ["react", "react-dom", "react-native-web"],
    alias: [
      { find: /^react-native$/, replacement: "react-native-web" },
      {
        find: /^react-native-svg$/,
        replacement: "react-native-svg/lib/module/ReactNativeSVG.web.js",
      },
    ],
  },
  optimizeDeps: {
    esbuildOptions: { resolveExtensions: extensions, loader: { ".js": "jsx" } },
  },
  plugins: [
    {
      name: "qrcode-web-jsx",
      enforce: "pre",
      transform(code, id) {
        if (id.includes("/react-native-qrcode-svg/") && id.endsWith(".js")) {
          return transformWithEsbuild(code, id, {
            loader: "jsx",
            jsx: "automatic",
          });
        }
      },
    },
    react(),
  ],
});
