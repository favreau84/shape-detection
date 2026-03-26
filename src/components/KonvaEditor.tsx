import { useRef, useEffect, useState, useCallback } from 'react';
import { Stage, Layer, Image as KonvaImage, Line, Circle, Text, Group } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type Konva from 'konva';
import type { Point, DrawTool, ScaleRef } from '../types';
import { screenToImage } from '../utils/geometry';

interface Props {
  imageSrc: string;
  imageWidth: number;
  imageHeight: number;
  shapePoints: Point[];
  scaleRef: ScaleRef | null;
  scalePoints: Point[];
  closed: boolean;
  editMode: boolean;
  activeTool: DrawTool;
  locked: boolean;
  scaleDragIdx: number | null;
  dragOffsetPx: number;
  onShapePointDrag: (index: number, pt: Point) => void;
  onScalePointDrag: (index: number, pt: Point) => void;
  onScaleDragStart: (index: number) => void;
  onScaleDragEnd: () => void;
  onCrosshairPosChange: (pos: Point | null) => void;
}

function useHTMLImage(src: string): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!src) return;
    const image = new window.Image();
    image.onload = () => setImg(image);
    image.src = src;
  }, [src]);
  return img;
}

export function KonvaEditor({
  imageSrc,
  imageWidth,
  imageHeight,
  shapePoints,
  scaleRef,
  scalePoints,
  closed,
  editMode,
  activeTool,
  locked,
  scaleDragIdx,
  dragOffsetPx,
  onShapePointDrag,
  onScalePointDrag,
  onScaleDragStart,
  onScaleDragEnd,
  onCrosshairPosChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const [stageScale, setStageScale] = useState(1);
  const lastDist = useRef(0);
  const lastCenter = useRef({ x: 0, y: 0 });
  const htmlImg = useHTMLImage(imageSrc);
  // Force re-render for crosshair (updates when stage moves)
  const [renderTick, setRenderTick] = useState(0);

  // Fit image in container on mount
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setStageSize({ width, height });
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Reset view when image loads
  useEffect(() => {
    if (imageWidth > 0 && stageSize.width > 0) {
      const scale = Math.min(stageSize.width / imageWidth, stageSize.height / imageHeight);
      setStageScale(scale);
      setStagePos({
        x: (stageSize.width - imageWidth * scale) / 2,
        y: (stageSize.height - imageHeight * scale) / 2,
      });
    }
  }, [imageWidth, imageHeight, stageSize]);

  // Wheel zoom
  const handleWheel = useCallback((e: KonvaEventObject<WheelEvent>) => {
    if (locked) return;
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const oldScale = stageScale;
    const delta = e.evt.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.min(20, Math.max(0.1, oldScale * delta));
    const mousePointTo = {
      x: (pointer.x - stagePos.x) / oldScale,
      y: (pointer.y - stagePos.y) / oldScale,
    };
    setStageScale(newScale);
    setStagePos({
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    });
  }, [locked, stageScale, stagePos]);

  // Pinch zoom
  const handleTouchMove = useCallback((e: KonvaEventObject<TouchEvent>) => {
    if (locked) return;
    const touch1 = e.evt.touches[0];
    const touch2 = e.evt.touches[1];
    if (!touch1 || !touch2) return;
    e.evt.preventDefault();

    const stage = stageRef.current;
    if (!stage) return;

    const p1 = { x: touch1.clientX, y: touch1.clientY };
    const p2 = { x: touch2.clientX, y: touch2.clientY };
    const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const center = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };

    if (lastDist.current === 0) {
      lastDist.current = dist;
      lastCenter.current = center;
      return;
    }

    const rect = stage.container().getBoundingClientRect();
    const cx = center.x - rect.left;
    const cy = center.y - rect.top;

    const oldScale = stageScale;
    const newScale = Math.min(20, Math.max(0.1, oldScale * (dist / lastDist.current)));
    const mousePointTo = {
      x: (cx - stagePos.x) / oldScale,
      y: (cy - stagePos.y) / oldScale,
    };

    setStageScale(newScale);
    setStagePos({
      x: cx - mousePointTo.x * newScale,
      y: cy - mousePointTo.y * newScale,
    });
    lastDist.current = dist;
    lastCenter.current = center;
  }, [locked, stageScale, stagePos]);

  const handleTouchEnd = useCallback(() => {
    lastDist.current = 0;
  }, []);

  const handleDragEnd = useCallback((e: KonvaEventObject<DragEvent>) => {
    if (e.target === stageRef.current) {
      setStagePos({ x: e.target.x(), y: e.target.y() });
      setRenderTick(n => n + 1);
    }
  }, []);

  const handleDragMove = useCallback(() => {
    setRenderTick(n => n + 1);
  }, []);


  // Report crosshair position to parent
  useEffect(() => {
    if (stageSize.width > 0) {
      const pos = screenToImage(
        stageSize.width / 2, stageSize.height / 2,
        stagePos.x, stagePos.y, stageScale
      );
      onCrosshairPosChange(pos);
    }
  }, [stagePos, stageScale, stageSize, onCrosshairPosChange, renderTick]);

  // Scale line data
  const scaleLine = scaleRef
    ? { p1: scaleRef.p1, p2: scaleRef.p2 }
    : (activeTool === 'scale' && scalePoints.length === 2)
      ? { p1: scalePoints[0], p2: scalePoints[1] }
      : null;

  const scaleDraggable = activeTool === 'scale' && !!scaleRef;
  const crosshairPos = stageSize.width > 0
    ? screenToImage(stageSize.width / 2, stageSize.height / 2, stagePos.x, stagePos.y, stageScale)
    : null;

  // Leader line
  const activePoints = activeTool === 'shape' ? shapePoints : scalePoints;
  const showLeader = !closed
    && crosshairPos
    && activePoints.length > 0
    && !(activeTool === 'scale' && (scalePoints.length >= 2 || scaleRef));
  const lastPoint = activePoints.length > 0 ? activePoints[activePoints.length - 1] : null;
  const leaderColor = activeTool === 'scale' ? '#2196F3' : '#F57C00';

  const liftOffset = dragOffsetPx / stageScale;

  return (
    <div ref={containerRef} className="editor-viewport" style={{ touchAction: 'none' }}>
      {stageSize.width > 0 && (
        <Stage
          ref={stageRef}
          width={stageSize.width}
          height={stageSize.height}
          x={stagePos.x}
          y={stagePos.y}
          scaleX={stageScale}
          scaleY={stageScale}
          draggable={!locked && !editMode}
          onWheel={handleWheel}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onDragEnd={handleDragEnd}
          onDragMove={handleDragMove}
        >
          <Layer>
            {/* Background image */}
            {htmlImg && <KonvaImage image={htmlImg} width={imageWidth} height={imageHeight} />}

            {/* Scale indicator */}
            {scaleLine && (() => {
              const { p1, p2 } = scaleLine;
              const dx = p2.x - p1.x;
              const dy = p2.y - p1.y;
              const len = Math.sqrt(dx * dx + dy * dy);
              if (len === 0) return null;
              const perpX = -dy / len;
              const perpY = dx / len;
              const ecH = 16 / stageScale;
              const sw = 2.5 / stageScale;

              return (
                <Group>
                  {/* Main bar */}
                  <Line points={[p1.x, p1.y, p2.x, p2.y]} stroke="#2196F3" strokeWidth={sw} lineCap="round" />
                  {/* Left endcap */}
                  <Line points={[p1.x, p1.y, p1.x + perpX * ecH, p1.y + perpY * ecH]} stroke="#2196F3" strokeWidth={sw} lineCap="round" />
                  {/* Right endcap */}
                  <Line points={[p2.x, p2.y, p2.x + perpX * ecH, p2.y + perpY * ecH]} stroke="#2196F3" strokeWidth={sw} lineCap="round" />
                  {/* Label */}
                  {scaleRef && (
                    <Text
                      x={(p1.x + p2.x) / 2 - 30 / stageScale}
                      y={(p1.y + p2.y) / 2 - 20 / stageScale}
                      text={`${scaleRef.valueCm.toFixed(1)} cm`}
                      fontSize={14 / stageScale}
                      fontStyle="bold"
                      fill="#2196F3"
                      width={60 / stageScale}
                      align="center"
                    />
                  )}
                  {/* Draggable endpoints */}
                  {scaleDraggable && [p1, p2].map((p, i) => {
                    const isDragging = scaleDragIdx === i;
                    return (
                      <Group key={`sc-${i}`}>
                        {isDragging && (
                          <>
                            <Line points={[p.x, p.y, p.x, p.y + liftOffset]} stroke="#2196F3" strokeWidth={1.5 / stageScale} opacity={0.5} />
                            <Circle x={p.x} y={p.y + liftOffset} radius={4 / stageScale} fill="#2196F3" opacity={0.4} />
                          </>
                        )}
                        <Circle
                          x={p.x}
                          y={p.y}
                          radius={14 / stageScale}
                          fill={isDragging ? '#1565C0' : '#2196F3'}
                          stroke="white"
                          strokeWidth={2 / stageScale}
                          draggable
                          onDragStart={() => onScaleDragStart(i)}
                          onDragMove={(e) => {
                            const node = e.target;
                            onScalePointDrag(i, { x: node.x(), y: node.y() - liftOffset });
                            // Keep the visual at the offset position
                            node.y(node.y());
                          }}
                          onDragEnd={() => onScaleDragEnd()}
                        />
                      </Group>
                    );
                  })}
                </Group>
              );
            })()}

            {/* In-progress scale: single point */}
            {activeTool === 'scale' && scalePoints.length === 1 && !scaleRef && (
              <Circle x={scalePoints[0].x} y={scalePoints[0].y} radius={5 / stageScale} fill="#2196F3" stroke="white" strokeWidth={1.5 / stageScale} />
            )}

            {/* Polygon fill when closed */}
            {closed && shapePoints.length >= 3 && (
              <Line
                points={shapePoints.flatMap(p => [p.x, p.y])}
                closed
                fill="rgba(245, 124, 0, 0.25)"
                stroke="#F57C00"
                strokeWidth={3 / stageScale}
                lineJoin="round"
              />
            )}

            {/* Open polyline */}
            {!closed && shapePoints.length >= 2 && (
              <Line
                points={shapePoints.flatMap(p => [p.x, p.y])}
                stroke="#F57C00"
                strokeWidth={3 / stageScale}
                lineJoin="round"
                lineCap="round"
              />
            )}

            {/* Dashed leader line */}
            {showLeader && lastPoint && crosshairPos && (
              <Line
                points={[lastPoint.x, lastPoint.y, crosshairPos.x, crosshairPos.y]}
                stroke={leaderColor}
                strokeWidth={2 / stageScale}
                dash={[6 / stageScale, 6 / stageScale]}
                lineCap="round"
                opacity={0.7}
              />
            )}

            {/* Shape points: only in edit mode */}
            {editMode && shapePoints.map((p, i) => (
              <Circle
                key={i}
                x={p.x}
                y={p.y}
                radius={12 / stageScale}
                fill={i === 0 && !closed ? '#FF9800' : '#F57C00'}
                stroke="white"
                strokeWidth={2 / stageScale}
                draggable
                onDragMove={(e) => {
                  onShapePointDrag(i, { x: e.target.x(), y: e.target.y() });
                }}
              />
            ))}

            {/* First point indicator when drawing */}
            {!editMode && !closed && shapePoints.length > 0 && activeTool === 'shape' && (
              <Circle
                x={shapePoints[0].x}
                y={shapePoints[0].y}
                radius={6 / stageScale}
                fill="#FF9800"
                stroke="white"
                strokeWidth={2 / stageScale}
              />
            )}
          </Layer>
        </Stage>
      )}

      {/* Crosshair (fixed center, outside Konva) */}
      {!editMode && !(activeTool === 'shape' && closed) && !(activeTool === 'scale' && (scalePoints.length >= 2 || scaleRef)) && (
        <div className="crosshair">
          <svg width="40" height="40" viewBox="0 0 40 40">
            <line x1="20" y1="4" x2="20" y2="16" stroke={activeTool === 'scale' ? '#2196F3' : '#F57C00'} strokeWidth="2" strokeLinecap="round" />
            <line x1="20" y1="24" x2="20" y2="36" stroke={activeTool === 'scale' ? '#2196F3' : '#F57C00'} strokeWidth="2" strokeLinecap="round" />
            <line x1="4" y1="20" x2="16" y2="20" stroke={activeTool === 'scale' ? '#2196F3' : '#F57C00'} strokeWidth="2" strokeLinecap="round" />
            <line x1="24" y1="20" x2="36" y2="20" stroke={activeTool === 'scale' ? '#2196F3' : '#F57C00'} strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>
      )}
    </div>
  );
}

// Export helper to get image pos at center of a container
export function getImagePosAtCenter(
  containerWidth: number,
  containerHeight: number,
  stageX: number,
  stageY: number,
  stageScale: number
): Point {
  return screenToImage(containerWidth / 2, containerHeight / 2, stageX, stageY, stageScale);
}
