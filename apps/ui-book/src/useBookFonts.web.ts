import { useEffect, useState } from "react";
import { Asset } from "expo-asset";
import { fonts } from "./assets";

export function useBookFonts(): [boolean, Error | null] {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    let active = true;
    const faces = [
      { asset: fonts.Manrope, weight: "400" },
      { asset: fonts.ManropeSemiBold, weight: "600" },
      { asset: fonts.ManropeBold, weight: "700" },
    ].map(
      ({ asset, weight }) =>
        new FontFace("Manrope", `url("${Asset.fromModule(asset).uri}")`, {
          weight,
        }),
    );
    void Promise.all(faces.map((face) => face.load()))
      .then(() => {
        if (!active) return;
        faces.forEach((face) => document.fonts.add(face));
        setLoaded(true);
      })
      .catch((cause: unknown) => {
        if (active)
          setError(
            cause instanceof Error
              ? cause
              : new Error("Could not load Manrope."),
          );
      });
    return () => {
      active = false;
      faces.forEach((face) => document.fonts.delete(face));
    };
  }, []);
  return [loaded, error];
}
