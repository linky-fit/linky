import { Asset } from "expo-asset";
import anna from "../assets/avatars/anna.png";
import tomas from "../assets/avatars/tomas.png";
import klara from "../assets/avatars/klara.png";
import profile from "../assets/avatars/profile.png";
import regular from "../assets/fonts/Manrope_400Regular.ttf";
import semibold from "../assets/fonts/Manrope_600SemiBold.ttf";
import bold from "../assets/fonts/Manrope_700Bold.ttf";

export const portraits = {
  anna: Asset.fromModule(anna).uri,
  tomas: Asset.fromModule(tomas).uri,
  klara: Asset.fromModule(klara).uri,
  profile: Asset.fromModule(profile).uri,
};

export const fonts = {
  Manrope: regular,
  ManropeSemiBold: semibold,
  ManropeBold: bold,
};
