import { Slot } from "expo-router";

/**
 * The app shell renders beside expo-router (src/navigation.tsx) and reads
 * its route through platform/navigation; the routes only claim URL space.
 */
export default function RootLayout() {
  return <Slot />;
}
