import type { Point, ScaleRef } from '../types';
import { computePxPerCm, formatAreaCm2, formatAreaPx } from '../utils/geometry';

interface Props {
  imageSrc: string;
  points: Point[];
  area: number;
  scaleRef: ScaleRef | null;
  imageWidth: number;
  imageHeight: number;
  onRestart: () => void;
}

export function ResultView({ imageSrc, points, area, scaleRef, imageWidth, imageHeight, onRestart }: Props) {
  const pxPerCm = scaleRef ? computePxPerCm(scaleRef.p1, scaleRef.p2, scaleRef.valueCm) : null;
  const areaCm2 = pxPerCm ? area / (pxPerCm * pxPerCm) : null;
  const areaDisplay = pxPerCm ? formatAreaCm2(area, pxPerCm) : formatAreaPx(area);
  const isOver = areaCm2 !== null && areaCm2 > 20;
  const polyColor = areaCm2 !== null ? (isOver ? '#E53935' : '#43A047') : '#F57C00';
  const polyFill = areaCm2 !== null
    ? (isOver ? 'rgba(229, 57, 53, 0.3)' : 'rgba(67, 160, 71, 0.3)')
    : 'rgba(245, 124, 0, 0.3)';

  // Polygon centroid for label placement
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const polyMinY = Math.min(...points.map(p => p.y));

  // Scale bar dimensions (in image px)
  const scaleBarCm = scaleRef ? scaleRef.valueCm : 0;
  const scaleBarPx = pxPerCm ? scaleBarCm * pxPerCm : 0;
  const sw = Math.max(imageWidth, imageHeight) / 300; // stroke width relative to image

  // Label font size relative to image
  const labelSize = Math.max(imageWidth, imageHeight) / 40;
  const scaleBarLabelSize = labelSize * 0.7;

  // Scale bar position: bottom-left with margin
  const margin = Math.max(imageWidth, imageHeight) * 0.04;
  const sbY = imageHeight - margin;
  const sbX = margin;
  const ecH = labelSize * 0.6; // endcap height

  return (
    <div className="result-screen">
      <div className="result-preview">
        <svg viewBox={`0 0 ${imageWidth} ${imageHeight}`} className="result-svg">
          {/* Full image */}
          <image href={imageSrc} width={imageWidth} height={imageHeight} />

          {/* Colored polygon overlay */}
          <polygon
            points={points.map(p => `${p.x},${p.y}`).join(' ')}
            fill={polyFill}
            stroke={polyColor}
            strokeWidth={sw * 2}
            strokeLinejoin="round"
          />

          {/* Area label just below the polygon */}
          <text
            x={cx}
            y={Math.max(polyMinY - labelSize * 0.3, labelSize * 1.5)}
            textAnchor="middle"
            fill={polyColor}
            fontSize={labelSize}
            fontWeight="700"
            fontFamily="system-ui, -apple-system, sans-serif"
            stroke="white"
            strokeWidth={sw * 0.8}
            paintOrder="stroke"
          >
            {areaDisplay}
          </text>

          {/* Scale bar (bottom-left) */}
          {pxPerCm && scaleBarPx > 0 && (
            <g>
              {/* Horizontal bar */}
              <line
                x1={sbX} y1={sbY}
                x2={sbX + scaleBarPx} y2={sbY}
                stroke="white"
                strokeWidth={sw * 2}
                strokeLinecap="round"
              />
              {/* Shadow for contrast */}
              <line
                x1={sbX} y1={sbY}
                x2={sbX + scaleBarPx} y2={sbY}
                stroke="rgba(0,0,0,0.5)"
                strokeWidth={sw * 4}
                strokeLinecap="round"
              />
              <line
                x1={sbX} y1={sbY}
                x2={sbX + scaleBarPx} y2={sbY}
                stroke="white"
                strokeWidth={sw * 2}
                strokeLinecap="round"
              />
              {/* Left endcap */}
              <line
                x1={sbX} y1={sbY - ecH / 2}
                x2={sbX} y2={sbY + ecH / 2}
                stroke="white"
                strokeWidth={sw * 2}
                strokeLinecap="round"
              />
              {/* Right endcap */}
              <line
                x1={sbX + scaleBarPx} y1={sbY - ecH / 2}
                x2={sbX + scaleBarPx} y2={sbY + ecH / 2}
                stroke="white"
                strokeWidth={sw * 2}
                strokeLinecap="round"
              />
              {/* Scale label */}
              <text
                x={sbX + scaleBarPx / 2}
                y={sbY - ecH * 0.8}
                textAnchor="middle"
                fill="white"
                fontSize={scaleBarLabelSize}
                fontWeight="600"
                fontFamily="system-ui, -apple-system, sans-serif"
                stroke="rgba(0,0,0,0.6)"
                strokeWidth={sw * 0.6}
                paintOrder="stroke"
              >
                {scaleBarCm.toFixed(0)} cm
              </text>
            </g>
          )}
        </svg>
      </div>

      <div className="result-footer">
        <button className="btn btn-primary" onClick={onRestart}>
          Nouvelle mesure
        </button>
      </div>
    </div>
  );
}
