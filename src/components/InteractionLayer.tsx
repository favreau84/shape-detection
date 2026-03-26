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
}: Props) {
  const { offsetX, offsetY, scale } = viewportState;

  // Determine which scale line to show: committed scaleRef or in-progress scalePoints
  const scaleLine = scaleRef
    ? { p1: scaleRef.p1, p2: scaleRef.p2 }
    : scalePoints.length === 2
      ? { p1: scalePoints[0], p2: scalePoints[1] }
      : null;

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

        {/* Scale reference line */}
        {scaleLine && (
          <>
            <line
              x1={scaleLine.p1.x}
              y1={scaleLine.p1.y}
              x2={scaleLine.p2.x}
              y2={scaleLine.p2.y}
              stroke="#2196F3"
              strokeWidth={2.5 / scale}
              strokeDasharray={`${6 / scale} ${4 / scale}`}
              strokeLinecap="round"
            />
            <circle cx={scaleLine.p1.x} cy={scaleLine.p1.y} r={5 / scale} fill="#2196F3" stroke="white" strokeWidth={1.5 / scale} />
            <circle cx={scaleLine.p2.x} cy={scaleLine.p2.y} r={5 / scale} fill="#2196F3" stroke="white" strokeWidth={1.5 / scale} />
          </>
        )}

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

        {/* Lines between shape points */}
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

        {/* Shape points */}
        {shapePoints.map((p, i) => (
          <g key={i}>
            <circle
              cx={p.x}
              cy={p.y}
              r={(editMode ? 12 : 6) / scale}
              fill={i === 0 && !closed ? '#FF9800' : '#F57C00'}
              stroke="white"
              strokeWidth={2 / scale}
              style={{ pointerEvents: editMode ? 'auto' : 'none', cursor: editMode ? 'grab' : 'default' }}
            />
            {editMode && dragIndex === i && (
              <circle
                cx={p.x}
                cy={p.y}
                r={18 / scale}
                fill="none"
                stroke="#F57C00"
                strokeWidth={2 / scale}
                strokeDasharray={`${4 / scale} ${4 / scale}`}
              />
            )}
          </g>
        ))}
      </g>
    </svg>
  );
}
