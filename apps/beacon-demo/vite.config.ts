import { linkyUi } from "@linky-fit/ui/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";

export default defineConfig({ plugins: [linkyUi(), react()] });
