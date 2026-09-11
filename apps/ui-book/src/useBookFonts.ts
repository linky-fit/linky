import { useFonts } from "expo-font";
import { fonts } from "./assets";

export function useBookFonts() {
  return useFonts(fonts);
}
