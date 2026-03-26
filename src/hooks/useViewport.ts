import { useCallback, useRef, useState } from 'react';
import type { ViewportState } from '../types';

export interface ViewportHandler {
  state: ViewportState;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onWheel: (e: React.WheelEvent) => void;
  resetView: (imageWidth: number, imageHeight: number) => void;
  locked: boolean;
  setLocked: (locked: boolean) => void;
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 10;

export function useViewport(): ViewportHandler {
  const [state, setState] = useState<ViewportState>({ offsetX: 0, offsetY: 0, scale: 1 });
  const [locked, setLocked] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const pinchDist = useRef<number | null>(null);
  const pinchScale = useRef(1);
  const activePointers = useRef<Map<number, { x: number; y: number }>>(new Map());

  const resetView = useCallback((imageWidth: number, imageHeight: number) => {
    const container = containerRef.current;
    if (!container) return;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const scale = Math.min(cw / imageWidth, ch / imageHeight);
    setState({
      scale,
      offsetX: (cw - imageWidth * scale) / 2,
      offsetY: (ch - imageHeight * scale) / 2,
    });
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (locked) return;
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    if (activePointers.current.size === 1) {
      dragging.current = true;
      lastPos.current = { x: e.clientX, y: e.clientY };
    } else if (activePointers.current.size === 2) {
      dragging.current = false;
      const pts = Array.from(activePointers.current.values());
      pinchDist.current = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      pinchScale.current = state.scale;
    }
  }, [locked, state.scale]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (locked) return;
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.current.size === 2 && pinchDist.current !== null) {
      const pts = Array.from(activePointers.current.values());
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      const ratio = dist / pinchDist.current;
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, pinchScale.current * ratio));

      const midX = (pts[0].x + pts[1].x) / 2;
      const midY = (pts[0].y + pts[1].y) / 2;
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const cx = midX - rect.left;
      const cy = midY - rect.top;

      setState(prev => {
        const scaleRatio = newScale / prev.scale;
        return {
          scale: newScale,
          offsetX: cx - (cx - prev.offsetX) * scaleRatio,
          offsetY: cy - (cy - prev.offsetY) * scaleRatio,
        };
      });
      return;
    }

    if (dragging.current && activePointers.current.size === 1) {
      const dx = e.clientX - lastPos.current.x;
      const dy = e.clientY - lastPos.current.y;
      lastPos.current = { x: e.clientX, y: e.clientY };
      setState(prev => ({
        ...prev,
        offsetX: prev.offsetX + dx,
        offsetY: prev.offsetY + dy,
      }));
    }
  }, [locked]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    activePointers.current.delete(e.pointerId);
    if (activePointers.current.size < 2) {
      pinchDist.current = null;
    }
    if (activePointers.current.size === 0) {
      dragging.current = false;
    }
    if (activePointers.current.size === 1) {
      const remaining = Array.from(activePointers.current.values())[0];
      lastPos.current = { x: remaining.x, y: remaining.y };
      dragging.current = true;
    }
  }, []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    if (locked) return;
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const delta = e.deltaY > 0 ? 0.9 : 1.1;

    setState(prev => {
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev.scale * delta));
      const scaleRatio = newScale / prev.scale;
      return {
        scale: newScale,
        offsetX: cx - (cx - prev.offsetX) * scaleRatio,
        offsetY: cy - (cy - prev.offsetY) * scaleRatio,
      };
    });
  }, [locked]);

  return {
    state,
    containerRef,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onWheel,
    resetView,
    locked,
    setLocked,
  };
}
