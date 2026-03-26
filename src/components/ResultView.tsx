import type { Point } from '../types';
import { formatArea } from '../utils/geometry';

interface Props {
  imageSrc: string;
  points: Point[];
  area: number;
  imageWidth: number;
  imageHeight: number;
  onRestart: () => void;
}

export function ResultView({ imageSrc, points, area, imageWidth, imageHeight, onRestart }: Props) {
  // Compute bounding box of polygon
  const minX = Math.min(...points.map(p => p.x));
  const maxX = Math.max(...points.map(p => p.x));
  const minY = Math.min(...points.map(p => p.y));
  const maxY = Math.max(...points.map(p => p.y));
  const pad = Math.max(maxX - minX, maxY - minY) * 0.2;
  const vbX = minX - pad;
  const vbY = minY - pad;
  const vbW = maxX - minX + pad * 2;
  const vbH = maxY - minY + pad * 2;

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
        </svg>
      </div>

      <div className="result-info">
        <div className="result-stat">
          <span className="result-stat-label">Surface mesurée</span>
          <span className="result-stat-value">{formatArea(area, imageWidth * imageHeight)}</span>
        </div>
        <div className="result-stat">
          <span className="result-stat-label">Nombre de points</span>
          <span className="result-stat-value">{points.length}</span>
        </div>
      </div>

      <div className="result-footer">
        <button className="btn btn-primary" onClick={onRestart}>
          Nouvelle mesure
        </button>
      </div>
    </div>
  );
}
