import { useState } from "react";
import * as UI from "@linky-fit/ui";
import type { Section } from "../section";
import { sampleImage } from "../sample-image";

export const overlays: Section = {
  title: "Overlays",
  entries: {
    Dialog: () => {
      const [open, setOpen] = useState<"dialog" | "full" | null>(null);
      return (
        <UI.Stack>
          <UI.Row flexWrap="wrap">
            <UI.Button onPress={() => setOpen("dialog")}>Open dialog</UI.Button>
            <UI.Button variant="secondary" onPress={() => setOpen("full")}>
              Open full screen
            </UI.Button>
          </UI.Row>
          <UI.Dialog
            open={open !== null}
            onOpenChange={(next) => {
              if (!next) setOpen(null);
            }}
            fullScreen={open === "full"}
            title="Example dialog"
            description="A local demonstration."
            closeLabel="Close dialog"
            actions={<UI.Button onPress={() => setOpen(null)}>Done</UI.Button>}
          >
            <UI.Text>Dialog content</UI.Text>
          </UI.Dialog>
        </UI.Stack>
      );
    },
    Sheet: () => {
      const [open, setOpen] = useState<"titled" | "untitled" | null>(null);
      const close = () => setOpen(null);
      return (
        <UI.Stack>
          <UI.Row flexWrap="wrap">
            <UI.Button onPress={() => setOpen("titled")}>Open sheet</UI.Button>
            <UI.Button variant="secondary" onPress={() => setOpen("untitled")}>
              Without title
            </UI.Button>
          </UI.Row>
          <UI.Sheet
            open={open !== null}
            onOpenChange={(next) => {
              if (!next) close();
            }}
            title="Example sheet"
            hideTitle={open === "untitled"}
          >
            <UI.ListRow title="First action" onPress={close} />
            <UI.ListRow title="Second action" onPress={close} />
            <UI.Button variant="secondary" onPress={close}>
              Close sheet
            </UI.Button>
          </UI.Sheet>
        </UI.Stack>
      );
    },
    GuidedTour: () => {
      const [step, setStep] = useState<number | null>(null);
      return (
        <UI.Stack>
          <UI.Button onPress={() => setStep(1)}>Open guided tour</UI.Button>
          {step === null ? null : (
            <UI.GuidedTour
              title="Example tour"
              description="Follow two short steps."
              step={step}
              total={2}
              target={null}
              back={{ label: "Back", onPress: () => setStep(1) }}
              next={{
                label: step === 2 ? "Finish" : "Next",
                onPress: () => setStep(step === 2 ? null : 2),
              }}
              skip={{ label: "Skip tour", onPress: () => setStep(null) }}
            />
          )}
        </UI.Stack>
      );
    },
    SuccessOverlay: () => {
      const [open, setOpen] = useState<
        "success" | "received" | "sending" | "contained" | null
      >(null);
      const close = () => setOpen(null);
      return (
        <UI.Stack>
          <UI.Row flexWrap="wrap">
            <UI.Button onPress={() => setOpen("success")}>
              Open success
            </UI.Button>
            <UI.Button variant="secondary" onPress={() => setOpen("received")}>
              Open received
            </UI.Button>
            <UI.Button variant="secondary" onPress={() => setOpen("sending")}>
              Open sending
            </UI.Button>
            <UI.Button variant="secondary" onPress={() => setOpen("contained")}>
              Open contained
            </UI.Button>
          </UI.Row>
          <UI.Card
            outlined
            position="relative"
            height="$device"
            overflow="hidden"
            justifyContent="center"
            alignItems="center"
          >
            <UI.Text color="$colorMuted">Positioned parent</UI.Text>
            {open === "contained" ? (
              <UI.SuccessOverlay
                title="Received"
                amount="21,000"
                unit="sat"
                avatar={{ name: "Alex Rivers", uri: sampleImage }}
                direction="in"
                contained
                onDismiss={close}
              />
            ) : null}
          </UI.Card>
          {open === "success" ? (
            <UI.SuccessOverlay
              title="Payment complete"
              amount="120"
              unit="sats"
              detail="Press anywhere to close"
              onDismiss={close}
            />
          ) : open === "sending" ? (
            <UI.SuccessOverlay
              title="Sending"
              amount="120"
              unit="sats"
              direction="out"
              pending
              onDismiss={close}
            />
          ) : open === "received" ? (
            <UI.SuccessOverlay
              title="Received"
              amount="120"
              unit="sats"
              avatar={{ name: "Alex Rivers", uri: sampleImage }}
              direction="in"
              onDismiss={close}
            />
          ) : null}
        </UI.Stack>
      );
    },
  },
};
