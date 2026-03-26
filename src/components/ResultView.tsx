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
  const minX = Math.min(...points.map(p => p.x));
  const maxX = Math.max(...points.map(p => p.x));
  const minY = Math.min(...points.map(p => p.y));
  const maxY = Math.max(...points.map(p => p.y));
  const pad = Math.max(maxX - minX, maxY - minY) * 0.2;
  const vbX = minX - pad;
  const vbY = minY - pad;
  const vbW = maxX - minX + pad * 2;
  const vbH = maxY - minY + pad * 2;

  const pxPerCm = scaleRef ? computePxPerCm(scaleRef.p1, scaleRef.p2, scaleRef.valueCm) : null;
  const areaDisplay = pxPerCm ? formatAreaCm2(area, pxPerCm) : formatAreaPx(area);

  return (
    <div className="result-screen">
      <div className="result-header">
        <h2>Résultat</h2>
      </div>

      <div className="result-preview">
        <svg viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`} className="result-svg">
          <image href={imageSrc} width={imageWidth} height={imageHeight} />
          <polygon
            points={points.map(p => `${p.x},${p.y}`).join(' ')}
            fill="rgba(245, 124, 0, 0.3)"
            stroke="#F57C00"
            strokeWidth={Math.max(vbW, vbH) / 150}
            strokeLinejoin="round"
          />
          {scaleRef && (
            <line
              x1={scaleRef.p1.x}
              y1={scaleRef.p1.y}
              x2={scaleRef.p2.x}
              y2={scaleRef.p2.y}
              stroke="#2196F3"
              strokeWidth={Math.max(vbW, vbH) / 200}
              strokeDasharray={`${Math.max(vbW, vbH) / 80} ${Math.max(vbW, vbH) / 120}`}
            />
          )}
        </svg>
      </div>

      <div className="result-info">
        <div className="result-stat">
          <span className="result-stat-label">Surface mesurée</span>
          <span className="result-stat-value">{areaDisplay}</span>
        </div>
        <div className="result-stat">
          <span className="result-stat-label">Points</span>
          <span className="result-stat-value">{points.length}</span>
        </div>
        {scaleRef && (
          <div className="result-stat">
            <span className="result-stat-label">Échelle</span>
            <span className="result-stat-value result-stat-blue">{scaleRef.valueCm.toFixed(1)} cm</span>
          </div>
        )}
      </div>

      <div className="result-footer">
        <button className="btn btn-primary" onClick={onRestart}>
          Nouvelle mesure
        </button>
      </div>
    </div>
  );
}
