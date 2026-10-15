import { Card } from "@linky-fit/ui";
import type { ComponentProps } from "react";

/** A page's main card; flat on wide screens, where the detail pane already frames the page. */
export const PageCard = (props: ComponentProps<typeof Card>) => (
  <Card
    {...props}
    $wide={{
      backgroundColor: "$transparent",
      boxShadow: "none",
      paddingHorizontal: "$none",
    }}
  />
);
