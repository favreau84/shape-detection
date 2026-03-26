import type { ViewportState, Point, DrawTool, ScaleRef } from '../types';

interface Props {
  viewportState: ViewportState;
  imageWidth: number;
  imageHeight: number;
  imageSrc: string;
  shapePoints: Point[];
  scalePoints: Point[];
  scaleRef: ScaleRef | null;
  closed: boolean;
  editMode: boolean;
  dragIndex: number | null;
  activeTool: DrawTool;
  crosshairImagePos: Point | null;
  scaleDragIdx: number | null;
  dragOffsetPx: number;
}

export function InteractionLayer({
  viewportState,
  imageWidth,
  imageHeight,
  imageSrc,
  shapePoints,
  scalePoints,
  scaleRef,
  closed,
  editMode,
  dragIndex,
  activeTool,
  crosshairImagePos,
  scaleDragIdx,
  dragOffsetPx,
}: Props) {
  const { offsetX, offsetY, scale } = viewportState;

  const scaleLine = scaleRef
    ? { p1: scaleRef.p1, p2: scaleRef.p2 }
    : (activeTool === 'scale' && scalePoints.length === 2)
      ? { p1: scalePoints[0], p2: scalePoints[1] }
      : null;

  const scaleDraggable = activeTool === 'scale' && !!scaleRef;

  const activePoints = activeTool === 'shape' ? shapePoints : scalePoints;
  const showLeader = !closed
    && crosshairImagePos
    && activePoints.length > 0
    && !(activeTool === 'scale' && (scalePoints.length >= 2 || scaleRef));
  const lastPoint = activePoints.length > 0 ? activePoints[activePoints.length - 1] : null;
  const leaderColor = activeTool === 'scale' ? '#2196F3' : '#F57C00';

  const liftOffsetImg = dragOffsetPx / scale;

  // Compute endcap height for scale indicator (perpendicular ticks)
  const endcapH = 16 / scale;

  return (
    <svg
      className="interaction-layer"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
      }}
    >
      <g transform={`translate(${offsetX}, ${offsetY}) scale(${scale})`}>
        <image href={imageSrc} width={imageWidth} height={imageHeight} />

        {/* Scale indicator: horizontal bar + vertical endcaps */}
        {scaleLine && (() => {
          const { p1, p2 } = scaleLine;
          const dx = p2.x - p1.x;
          const dy = p2.y - p1.y;
          const len = Math.sqrt(dx * dx + dy * dy);
          if (len === 0) return null;
          // Perpendicular direction (pointing "down" from the bar)
          const perpX = -dy / len;
          const perpY = dx / len;

          return (
            <>
              {/* Main horizontal bar */}
              <line
                x1={p1.x} y1={p1.y}
                x2={p2.x} y2={p2.y}
                stroke="#2196F3"
                strokeWidth={2.5 / scale}
                strokeLinecap="round"
              />
              {/* Left endcap: vertical tick going down to ruler centerline */}
              <line
                x1={p1.x} y1={p1.y}
                x2={p1.x + perpX * endcapH} y2={p1.y + perpY * endcapH}
                stroke="#2196F3"
                strokeWidth={2.5 / scale}
                strokeLinecap="round"
              />
              {/* Right endcap */}
              <line
                x1={p2.x} y1={p2.y}
                x2={p2.x + perpX * endcapH} y2={p2.y + perpY * endcapH}
                stroke="#2196F3"
                strokeWidth={2.5 / scale}
                strokeLinecap="round"
              />

              {/* Cm label at center of the bar */}
              {scaleRef && (
                <text
                  x={(p1.x + p2.x) / 2}
                  y={(p1.y + p2.y) / 2 - 8 / scale}
                  textAnchor="middle"
                  fill="#2196F3"
                  fontSize={14 / scale}
                  fontWeight="700"
                  fontFamily="system-ui, sans-serif"
                  style={{ pointerEvents: 'none' }}
                >
                  {scaleRef.valueCm.toFixed(1)} cm
                </text>
              )}

              {/* Draggable discs at endpoints (only when in scale tool) */}
              {scaleDraggable && [p1, p2].map((p, i) => {
                const isDragging = scaleDragIdx === i;
                return (
                  <g key={`scale-${i}`}>
                    {isDragging && (
                      <>
                        <line
                          x1={p.x} y1={p.y}
                          x2={p.x} y2={p.y + liftOffsetImg}
                          stroke="#2196F3"
                          strokeWidth={1.5 / scale}
                          opacity={0.5}
                        />
                        <circle
                          cx={p.x} cy={p.y + liftOffsetImg}
                          r={4 / scale}
                          fill="#2196F3" opacity={0.4}
                        />
                      </>
                    )}
                    <circle
                      cx={p.x} cy={p.y}
                      r={12 / scale}
                      fill={isDragging ? '#1565C0' : '#2196F3'}
                      stroke="white"
                      strokeWidth={2 / scale}
                    />
                  </g>
                );
              })}
            </>
          );
        })()}

        {/* In-progress scale: single point */}
        {activeTool === 'scale' && scalePoints.length === 1 && !scaleRef && (
          <circle
            cx={scalePoints[0].x}
            cy={scalePoints[0].y}
            r={5 / scale}
            fill="#2196F3"
            stroke="white"
            strokeWidth={1.5 / scale}
          />
        )}

        {/* Polygon fill when closed */}
        {closed && shapePoints.length >= 3 && (
          <polygon
            points={shapePoints.map(p => `${p.x},${p.y}`).join(' ')}
            fill="rgba(245, 124, 0, 0.25)"
            stroke="#F57C00"
            strokeWidth={3 / scale}
            strokeLinejoin="round"
          />
        )}

        {/* Lines between shape points (open polyline) */}
        {!closed && shapePoints.length >= 2 && (
          <polyline
            points={shapePoints.map(p => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke="#F57C00"
            strokeWidth={3 / scale}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}

        {/* Dashed leader line from last point to crosshair */}
        {showLeader && lastPoint && crosshairImagePos && (
          <line
            x1={lastPoint.x} y1={lastPoint.y}
            x2={crosshairImagePos.x} y2={crosshairImagePos.y}
            stroke={leaderColor}
            strokeWidth={2 / scale}
            strokeDasharray={`${6 / scale} ${6 / scale}`}
            strokeLinecap="round"
            opacity={0.7}
          />
        )}

        {/* Shape points: ONLY visible in edit mode */}
        {editMode && shapePoints.map((p, i) => (
          <g key={i}>
            <circle
              cx={p.x} cy={p.y}
              r={12 / scale}
              fill={i === 0 && !closed ? '#FF9800' : '#F57C00'}
              stroke="white"
              strokeWidth={2 / scale}
              style={{ pointerEvents: 'auto', cursor: 'grab' }}
            />
            {dragIndex === i && (
              <circle
                cx={p.x} cy={p.y}
                r={18 / scale}
                fill="none"
                stroke="#F57C00"
                strokeWidth={2 / scale}
                strokeDasharray={`${4 / scale} ${4 / scale}`}
              />
            )}
          </g>
        ))}

        {/* First point indicator when drawing (not editing, not closed) */}
        {!editMode && !closed && shapePoints.length > 0 && activeTool === 'shape' && (
          <circle
            cx={shapePoints[0].x}
            cy={shapePoints[0].y}
            r={6 / scale}
            fill="#FF9800"
            stroke="white"
            strokeWidth={2 / scale}
          />
        )}
      </g>
    </svg>
  );
}
