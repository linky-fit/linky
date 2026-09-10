import React from "react";

const MIN_SCALE = 1;
const MAX_SCALE = 6;
const DOUBLE_TAP_SCALE = 2.5;
const DOUBLE_TAP_MS = 300;
const TAP_MOVE_THRESHOLD_PX = 6;
const WHEEL_ZOOM_SENSITIVITY = 0.01;

interface Point {
  x: number;
  y: number;
}

export interface ImageZoomTransform {
  scale: number;
  x: number;
  y: number;
}

interface GestureStart {
  center: Point;
  distance: number;
  transform: ImageZoomTransform;
}

interface StageGeometry {
  center: Point;
  half: Point;
}

const IDENTITY: ImageZoomTransform = { scale: 1, x: 0, y: 0 };

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const relativeTo = (point: Point, origin: Point): Point => ({
  x: point.x - origin.x,
  y: point.y - origin.y,
});

const summarizePointers = (
  pointers: readonly Point[],
): { center: Point; distance: number } => {
  const [first, second] = pointers;
  if (!first) return { center: { x: 0, y: 0 }, distance: 0 };
  if (!second) return { center: first, distance: 0 };
  return {
    center: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
    distance: Math.hypot(second.x - first.x, second.y - first.y),
  };
};

// Scales from `start` so the image point under `center` stays under it, then
// keeps the image from being pushed fully out of the stage.
const transformAround = (
  start: GestureStart,
  center: Point,
  scale: number,
  half: Point,
): ImageZoomTransform => {
  const ratio = scale / start.transform.scale;
  const limitX = (scale - 1) * half.x;
  const limitY = (scale - 1) * half.y;
  return {
    scale,
    x: clamp(
      center.x - (start.center.x - start.transform.x) * ratio,
      -limitX,
      limitX,
    ),
    y: clamp(
      center.y - (start.center.y - start.transform.y) * ratio,
      -limitY,
      limitY,
    ),
  };
};

const geometryOf = (stage: HTMLElement): StageGeometry => {
  const rect = stage.getBoundingClientRect();
  return {
    center: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
    half: { x: rect.width / 2, y: rect.height / 2 },
  };
};

export const useImageZoom = (
  stageRef: React.RefObject<HTMLDivElement | null>,
  enabled: boolean,
) => {
  const [transform, setTransformState] =
    React.useState<ImageZoomTransform>(IDENTITY);
  const [isGesturing, setIsGesturing] = React.useState(false);
  const transformRef = React.useRef(IDENTITY);
  const geometryRef = React.useRef<StageGeometry | null>(null);
  const pointersRef = React.useRef(new Map<number, Point>());
  const gestureRef = React.useRef<GestureStart | null>(null);
  const suppressClickRef = React.useRef(false);
  const lastTapAtRef = React.useRef(0);

  const setTransform = React.useCallback((next: ImageZoomTransform) => {
    transformRef.current = next;
    setTransformState(next);
  }, []);

  const relativePointers = (geometry: StageGeometry) =>
    Array.from(pointersRef.current.values()).map((point) =>
      relativeTo(point, geometry.center),
    );

  const beginGesture = (geometry: StageGeometry) => {
    gestureRef.current = {
      ...summarizePointers(relativePointers(geometry)),
      transform: transformRef.current,
    };
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const geometry = geometryRef.current ?? geometryOf(event.currentTarget);
    geometryRef.current = geometry;
    if (pointersRef.current.size === 0) {
      suppressClickRef.current = false;
      setIsGesturing(true);
    }
    pointersRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // jsdom has no pointer capture; touch browsers do.
    }
    beginGesture(geometry);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    const geometry = geometryRef.current;
    if (!gesture || !geometry || !pointersRef.current.has(event.pointerId))
      return;
    pointersRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    const pointers = relativePointers(geometry);
    const { center, distance } = summarizePointers(pointers);
    if (
      !suppressClickRef.current &&
      Math.hypot(center.x - gesture.center.x, center.y - gesture.center.y) >
        TAP_MOVE_THRESHOLD_PX
    ) {
      suppressClickRef.current = true;
    }
    const scale =
      pointers.length > 1 && gesture.distance > 0
        ? clamp(
            (gesture.transform.scale * distance) / gesture.distance,
            MIN_SCALE,
            MAX_SCALE,
          )
        : gesture.transform.scale;
    if (pointers.length === 1 && (scale === 1 || !suppressClickRef.current))
      return;
    setTransform(transformAround(gesture, center, scale, geometry.half));
  };

  const onPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.delete(event.pointerId)) return;
    const geometry = geometryRef.current;
    if (pointersRef.current.size > 0) {
      if (geometry) beginGesture(geometry);
      return;
    }
    gestureRef.current = null;
    geometryRef.current = null;
    setIsGesturing(false);
    if (event.type === "pointercancel" || suppressClickRef.current) {
      lastTapAtRef.current = 0;
      return;
    }
    const now = performance.now();
    if (now - lastTapAtRef.current > DOUBLE_TAP_MS) {
      lastTapAtRef.current = now;
      return;
    }
    lastTapAtRef.current = 0;
    suppressClickRef.current = true;
    if (transformRef.current.scale > 1 || !geometry) {
      setTransform(IDENTITY);
      return;
    }
    const center = relativeTo(
      { x: event.clientX, y: event.clientY },
      geometry.center,
    );
    setTransform(
      transformAround(
        { center, distance: 0, transform: IDENTITY },
        center,
        DOUBLE_TAP_SCALE,
        geometry.half,
      ),
    );
  };

  const onClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!suppressClickRef.current) return;
    suppressClickRef.current = false;
    event.stopPropagation();
  };

  const onWheel = React.useCallback(
    (event: WheelEvent) => {
      const stage = stageRef.current;
      if (!stage) return;
      event.preventDefault();
      const geometry = geometryOf(stage);
      const current = transformRef.current;
      const scale = clamp(
        current.scale * Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY),
        MIN_SCALE,
        MAX_SCALE,
      );
      const center = relativeTo(
        { x: event.clientX, y: event.clientY },
        geometry.center,
      );
      setTransform(
        transformAround(
          { center, distance: 0, transform: current },
          center,
          scale,
          geometry.half,
        ),
      );
    },
    [setTransform, stageRef],
  );

  // React registers wheel listeners as passive, so the page-scroll default
  // has to be cancelled from a listener attached here.
  React.useEffect(() => {
    const stage = stageRef.current;
    if (!enabled || !stage) return;
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [enabled, onWheel, stageRef]);

  const reset = React.useCallback(() => {
    pointersRef.current.clear();
    gestureRef.current = null;
    geometryRef.current = null;
    setTransform(IDENTITY);
    setIsGesturing(false);
  }, [setTransform]);

  return {
    handlers: {
      onClickCapture,
      onPointerCancel: onPointerEnd,
      onPointerDown,
      onPointerMove,
      onPointerUp: onPointerEnd,
    },
    imageStyle: {
      transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
      transition: isGesturing ? "none" : "transform 160ms ease-out",
    },
    isZoomed: transform.scale > 1,
    reset,
  };
};
