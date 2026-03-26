import { useRef, useEffect, useState, useCallback } from 'react';
import { Stage, Layer, Image as KonvaImage, Line, Circle, Text, Group } from 'react-konva';
import Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type { Point, DrawTool, ScaleRef } from '../types';
import { screenToImage } from '../utils/geometry';

// Required for touchmove to fire correctly during drag
Konva.hitOnDragEnabled = true;

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
  areaCm2: number | null;
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
  areaCm2,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const htmlImg = useHTMLImage(imageSrc);
  const [renderTick, setRenderTick] = useState(0);

  // Pinch state refs (not in React state to avoid re-render lag)
  const lastDist = useRef(0);
  const lastCenter = useRef<{ x: number; y: number } | null>(null);
  const dragStopped = useRef(false);

  // Observe container size
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
    const stage = stageRef.current;
    if (!stage || imageWidth === 0 || stageSize.width === 0) return;
    const scale = Math.min(stageSize.width / imageWidth, stageSize.height / imageHeight);
    stage.scaleX(scale);
    stage.scaleY(scale);
    stage.position({
      x: (stageSize.width - imageWidth * scale) / 2,
      y: (stageSize.height - imageHeight * scale) / 2,
    });
    stage.batchDraw();
    setRenderTick(n => n + 1);
  }, [imageWidth, imageHeight, stageSize]);

  // Wheel zoom
  const handleWheel = useCallback((e: KonvaEventObject<WheelEvent>) => {
    if (locked) return;
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const oldScale = stage.scaleX();
    const delta = e.evt.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.min(20, Math.max(0.1, oldScale * delta));
    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    };
    stage.scaleX(newScale);
    stage.scaleY(newScale);
    stage.position({
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    });
    stage.batchDraw();
    setRenderTick(n => n + 1);
  }, [locked]);

  // Pinch zoom — following Konva's official multi-touch pattern
  const handleTouchMove = useCallback((e: KonvaEventObject<TouchEvent>) => {
    const stage = stageRef.current;
    if (!stage) return;
    const touch1 = e.evt.touches[0];
    const touch2 = e.evt.touches[1];

    // Restore single-finger drag if it was interrupted by pinch
    if (touch1 && !touch2 && !stage.isDragging() && dragStopped.current) {
      stage.startDrag();
      dragStopped.current = false;
    }

    if (touch1 && touch2) {
      e.evt.preventDefault();

      // Stop Konva's built-in drag during pinch
      if (stage.isDragging()) {
        dragStopped.current = true;
        stage.stopDrag();
      }

      const p1 = { x: touch1.clientX, y: touch1.clientY };
      const p2 = { x: touch2.clientX, y: touch2.clientY };

      if (!lastCenter.current) {
        lastCenter.current = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
        lastDist.current = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        return;
      }

      const newCenter = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);

      if (lastDist.current === 0) {
        lastDist.current = dist;
        return;
      }

      // Point to zoom towards (in stage local coords)
      const pointTo = {
        x: (newCenter.x - stage.x()) / stage.scaleX(),
        y: (newCenter.y - stage.y()) / stage.scaleX(),
      };

      const newScale = Math.min(20, Math.max(0.1, stage.scaleX() * (dist / lastDist.current)));
      stage.scaleX(newScale);
      stage.scaleY(newScale);

      // New position: keep pinch center fixed + apply pan delta
      const dx = newCenter.x - lastCenter.current.x;
      const dy = newCenter.y - lastCenter.current.y;
      stage.position({
        x: newCenter.x - pointTo.x * newScale + dx,
        y: newCenter.y - pointTo.y * newScale + dy,
      });

      stage.batchDraw();
      lastDist.current = dist;
      lastCenter.current = newCenter;
      setRenderTick(n => n + 1);
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    lastDist.current = 0;
    lastCenter.current = null;
  }, []);

  const handleDragEnd = useCallback(() => {
    setRenderTick(n => n + 1);
  }, []);

  const handleDragMove = useCallback(() => {
    setRenderTick(n => n + 1);
  }, []);

  // Report crosshair position to parent
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || stageSize.width === 0) return;
    const pos = screenToImage(
      stageSize.width / 2, stageSize.height / 2,
      stage.x(), stage.y(), stage.scaleX()
    );
    onCrosshairPosChange(pos);
  }, [stageSize, onCrosshairPosChange, renderTick]);

  // Current stage values for rendering
  const stage = stageRef.current;
  const currentScale = stage?.scaleX() ?? 1;

  // Scale line data
  const scaleLine = scaleRef
    ? { p1: scaleRef.p1, p2: scaleRef.p2 }
    : (activeTool === 'scale' && scalePoints.length === 2)
      ? { p1: scalePoints[0], p2: scalePoints[1] }
      : null;

  const scaleDraggable = activeTool === 'scale' && !!scaleRef;

  const crosshairPos = stage && stageSize.width > 0
    ? screenToImage(stageSize.width / 2, stageSize.height / 2, stage.x(), stage.y(), stage.scaleX())
    : null;

  // Leader line
  const activePoints = activeTool === 'shape' ? shapePoints : scalePoints;
  const showLeader = !closed
    && crosshairPos
    && activePoints.length > 0
    && !(activeTool === 'scale' && (scalePoints.length >= 2 || scaleRef));
  const lastPoint = activePoints.length > 0 ? activePoints[activePoints.length - 1] : null;
  const leaderColor = activeTool === 'scale' ? '#2196F3' : '#F57C00';

  const liftOffset = dragOffsetPx / currentScale;

  return (
    <div ref={containerRef} className="editor-viewport" style={{ touchAction: 'none' }}>
      {stageSize.width > 0 && (
        <Stage
          ref={stageRef}
          width={stageSize.width}
          height={stageSize.height}
          draggable={!locked && !editMode}
          onWheel={handleWheel}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onDragEnd={handleDragEnd}
          onDragMove={handleDragMove}
        >
          <Layer>
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
              const ecH = 16 / currentScale;
              const sw = 2.5 / currentScale;

              return (
                <Group>
                  <Line points={[p1.x, p1.y, p2.x, p2.y]} stroke="#2196F3" strokeWidth={sw} lineCap="round" />
                  <Line points={[p1.x, p1.y, p1.x + perpX * ecH, p1.y + perpY * ecH]} stroke="#2196F3" strokeWidth={sw} lineCap="round" />
                  <Line points={[p2.x, p2.y, p2.x + perpX * ecH, p2.y + perpY * ecH]} stroke="#2196F3" strokeWidth={sw} lineCap="round" />
                  {scaleRef && (
                    <Text
                      x={(p1.x + p2.x) / 2 - 30 / currentScale}
                      y={(p1.y + p2.y) / 2 - 20 / currentScale}
                      text={`${scaleRef.valueCm.toFixed(1)} cm`}
                      fontSize={14 / currentScale}
                      fontStyle="bold"
                      fill="#2196F3"
                      width={60 / currentScale}
                      align="center"
                    />
                  )}
                  {scaleDraggable && [p1, p2].map((p, i) => {
                    const isDragging = scaleDragIdx === i;
                    return (
                      <Group key={`sc-${i}`}>
                        {isDragging && (
                          <>
                            <Line points={[p.x, p.y, p.x, p.y + liftOffset]} stroke="#2196F3" strokeWidth={1.5 / currentScale} opacity={0.5} />
                            <Circle x={p.x} y={p.y + liftOffset} radius={4 / currentScale} fill="#2196F3" opacity={0.4} />
                          </>
                        )}
                        <Circle
                          x={p.x} y={p.y}
                          radius={14 / currentScale}
                          fill={isDragging ? '#1565C0' : '#2196F3'}
                          stroke="white" strokeWidth={2 / currentScale}
                          draggable
                          onDragStart={() => onScaleDragStart(i)}
                          onDragMove={(e) => {
                            onScalePointDrag(i, { x: e.target.x(), y: e.target.y() - liftOffset });
                          }}
                          onDragEnd={() => onScaleDragEnd()}
                        />
                      </Group>
                    );
                  })}
                </Group>
              );
            })()}

            {activeTool === 'scale' && scalePoints.length === 1 && !scaleRef && (
              <Circle x={scalePoints[0].x} y={scalePoints[0].y} radius={5 / currentScale} fill="#2196F3" stroke="white" strokeWidth={1.5 / currentScale} />
            )}

            {closed && shapePoints.length >= 3 && (() => {
              const isOver = areaCm2 !== null && areaCm2 > 20;
              const polyColor = areaCm2 !== null ? (isOver ? '#E53935' : '#43A047') : '#F57C00';
              const polyFill = areaCm2 !== null
                ? (isOver ? 'rgba(229, 57, 53, 0.25)' : 'rgba(67, 160, 71, 0.25)')
                : 'rgba(245, 124, 0, 0.25)';
              return (
                <Line
                  points={shapePoints.flatMap(p => [p.x, p.y])}
                  closed fill={polyFill} stroke={polyColor}
                  strokeWidth={3 / currentScale} lineJoin="round"
                />
              );
            })()}

            {!closed && shapePoints.length >= 2 && (
              <Line
                points={shapePoints.flatMap(p => [p.x, p.y])}
                stroke="#F57C00" strokeWidth={3 / currentScale}
                lineJoin="round" lineCap="round"
              />
            )}

            {showLeader && lastPoint && crosshairPos && (
              <Line
                points={[lastPoint.x, lastPoint.y, crosshairPos.x, crosshairPos.y]}
                stroke={leaderColor} strokeWidth={2 / currentScale}
                dash={[6 / currentScale, 6 / currentScale]}
                lineCap="round" opacity={0.7}
              />
            )}

            {editMode && shapePoints.map((p, i) => (
              <Circle key={i} x={p.x} y={p.y}
                radius={12 / currentScale}
                fill={i === 0 && !closed ? '#FF9800' : '#F57C00'}
                stroke="white" strokeWidth={2 / currentScale}
                draggable
                onDragMove={(e) => onShapePointDrag(i, { x: e.target.x(), y: e.target.y() })}
              />
            ))}

            {!editMode && !closed && shapePoints.length > 0 && activeTool === 'shape' && (
              <Circle x={shapePoints[0].x} y={shapePoints[0].y}
                radius={6 / currentScale} fill="#FF9800" stroke="white" strokeWidth={2 / currentScale}
              />
            )}
          </Layer>
        </Stage>
      )}

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
