import { size, space } from "./tokens";

/** The gap between `NearbyAvatar`s in a `NearbyRow`. */
export const nearbyRowGap = space.xs;

/** How many `NearbyAvatar`s fit side by side, without scrolling, in a `NearbyRow` of this content width. */
export const nearbyRowCapacity = (width: number): number =>
  Math.max(1, Math.floor((width + nearbyRowGap) / (size.row + nearbyRowGap)));
