import type { ComponentType } from "react";
import type { ColorMode, ThemePalette } from "@linky-fit/ui";

/** A book category whose entries are examples named after what they show. */
export interface Section {
  title: string;
  entries: Record<
    string,
    ComponentType<{ mode: ColorMode; palette: ThemePalette }>
  >;
}
