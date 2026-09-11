import { useState } from "react";

export function useRoute(): [string, (route: string) => void] {
  const [route, setRoute] = useState("/");
  return [route, setRoute];
}
