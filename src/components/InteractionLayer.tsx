import type { ViewportState, Point } from '../types';

interface Props {
  viewportState: ViewportState;
  imageWidth: number;
  imageHeight: number;
  imageSrc: string;
  points: Point[];
  closed: boolean;
  editMode: boolean;
  dragIndex: number | null;
}

export function InteractionLayer({
  viewportState,
  imageWidth,
  imageHeight,
  imageSrc,
  points,
  closed,
  editMode,
  dragIndex,
}: Props) {
  const { offsetX, offsetY, scale } = viewportState;

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

        {/* Polygon fill when closed */}
        {closed && points.length >= 3 && (
          <polygon
            points={points.map(p => `${p.x},${p.y}`).join(' ')}
            fill="rgba(245, 124, 0, 0.25)"
            stroke="#F57C00"
            strokeWidth={3 / scale}
            strokeLinejoin="round"
          />
        )}

        {/* Lines between points */}
        {!closed && points.length >= 2 && (
          <polyline
            points={points.map(p => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke="#F57C00"
            strokeWidth={3 / scale}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}

        {/* Points */}
        {points.map((p, i) => (
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
