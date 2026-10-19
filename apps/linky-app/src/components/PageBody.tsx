import { PageScroll, Stack } from "@linky-fit/ui";
import type { ComponentProps } from "react";

const gutters = {
  page: {
    paddingHorizontal: "$xl",
    paddingTop: "$xxxl",
    paddingBottom: "$huge",
  },
  detail: {
    paddingHorizontal: "$xxl",
    paddingTop: "$lg",
    paddingBottom: "$xxl",
  },
} as const;

type PageBodyProps = ComponentProps<typeof Stack> & {
  /** `detail` is the desktop detail pane, below its own top bar. */
  gutter?: keyof typeof gutters;
};

/** A page's content inside the app gutter. */
export const PageBody = ({ gutter = "page", ...props }: PageBodyProps) => (
  <PageScroll testID="page-scroll">
    <Stack flexGrow={1} {...gutters[gutter]} {...props} />
  </PageScroll>
);
