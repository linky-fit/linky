import { useRef, useState } from "react";
import * as UI from "@linky-fit/ui";
import type { Section } from "../section";
import { sampleImage } from "../sample-image";

export const media: Section = {
  title: "Media",
  entries: {
    DeviceFrame: () => (
      <UI.DeviceFrame alignSelf="center" aria-label="Phone">
        <UI.Image
          src={sampleImage}
          width="100%"
          height="100%"
          objectFit="cover"
        />
      </UI.DeviceFrame>
    ),
    MediaFrame: () => (
      <UI.Stack>
        <UI.MediaFrame
          accessibilityLabel="Framed color study"
          aspectRatio={4 / 3}
        >
          <UI.Image
            src={sampleImage}
            width="100%"
            height="100%"
            objectFit="cover"
          />
        </UI.MediaFrame>
        <UI.Text variant="caption" color="$colorMuted">
          Filling a fixed-height column
        </UI.Text>
        <UI.Stack height="$column">
          <UI.MediaFrame accessibilityLabel="Filled color study" fill>
            <UI.Image
              src={sampleImage}
              width="100%"
              height="100%"
              objectFit="cover"
            />
          </UI.MediaFrame>
        </UI.Stack>
      </UI.Stack>
    ),
    SandboxedHtml: () => (
      <UI.Stack>
        <UI.SandboxedHtml
          title="Announcement"
          height={160}
          html={
            '<h3>Firmware 2.8 is out</h3><p>Update from the device menu. <a href="https://example.com/notes">Release notes</a></p>'
          }
        />
        <UI.Text variant="caption" color="$colorMuted">
          Web only: scripts, same-origin access and remote media stay blocked
        </UI.Text>
      </UI.Stack>
    ),
    CameraPreview: () => {
      const [camera, setCamera] = useState<MediaStream | null>(null);
      const video = useRef<HTMLVideoElement>(null);
      const toggleCamera = async () => {
        if (camera) {
          camera.getTracks().forEach((track) => track.stop());
          setCamera(null);
          return;
        }
        const stream = await navigator.mediaDevices?.getUserMedia({
          video: true,
        });
        if (!stream || !video.current) return;
        video.current.srcObject = stream;
        setCamera(stream);
      };
      return (
        <UI.Stack>
          <UI.MediaFrame accessibilityLabel="Camera preview" aspectRatio={1}>
            <UI.CameraPreview videoRef={video} mirrored />
          </UI.MediaFrame>
          <UI.Button variant="secondary" icon="Camera" onPress={toggleCamera}>
            {camera ? "Stop camera" : "Start camera (web)"}
          </UI.Button>
        </UI.Stack>
      );
    },
    ImageCropPreview: () => {
      const [center, setCenter] = useState<UI.ImageCropCenter>({
        x: 96,
        y: 96,
      });
      const [zoom, setZoom] = useState(1);
      return (
        <UI.Stack>
          <UI.ImageCropPreview
            uri={sampleImage}
            accessibilityLabel="Drag to crop"
            imageWidth={192}
            imageHeight={192}
            center={center}
            zoom={zoom}
            onCenterChange={setCenter}
          />
          <UI.SliderField
            label="Crop zoom"
            value={zoom}
            min={1}
            max={3}
            step={0.1}
            onValueChange={setZoom}
          />
        </UI.Stack>
      );
    },
    DocumentPages: () => (
      <UI.Stack height="$qr">
        <UI.DocumentPages
          pages={[
            {
              uri: sampleImage,
              accessibilityLabel: "Example document page",
              width: 192,
              height: 192,
            },
          ]}
        />
      </UI.Stack>
    ),
  },
};
