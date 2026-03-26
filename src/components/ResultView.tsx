import { useRef, useCallback } from 'react';
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
  const svgRef = useRef<SVGSVGElement>(null);
  const pxPerCm = scaleRef ? computePxPerCm(scaleRef.p1, scaleRef.p2, scaleRef.valueCm) : null;
  const areaCm2 = pxPerCm ? area / (pxPerCm * pxPerCm) : null;
  const areaDisplay = pxPerCm ? formatAreaCm2(area, pxPerCm) : formatAreaPx(area);
  const isOver = areaCm2 !== null && areaCm2 > 20;
  const polyColor = areaCm2 !== null ? (isOver ? '#E53935' : '#43A047') : '#F57C00';
  const polyFill = areaCm2 !== null
    ? (isOver ? 'rgba(229, 57, 53, 0.3)' : 'rgba(67, 160, 71, 0.3)')
    : 'rgba(245, 124, 0, 0.3)';
  const badgeBg = areaCm2 !== null ? (isOver ? '#E53935' : '#43A047') : '#F57C00';

  // Polygon centroid + bottom for label placement
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const polyMaxY = Math.max(...points.map(p => p.y));

  // Sizes relative to image
  const sw = Math.max(imageWidth, imageHeight) / 300;
  const labelSize = Math.max(imageWidth, imageHeight) / 35;
  const scaleBarLabelSize = labelSize * 0.9;
  const margin = Math.max(imageWidth, imageHeight) * 0.04;

  // Badge dimensions
  const badgePadH = labelSize * 0.5;
  const badgePadV = labelSize * 0.3;
  const badgeW = areaDisplay.length * labelSize * 0.55 + badgePadH * 2;
  const badgeH = labelSize + badgePadV * 2;
  const badgeX = cx - badgeW / 2;
  const badgeY = polyMaxY + labelSize * 0.5;

  // Scale bar
  const scaleBarCm = scaleRef ? scaleRef.valueCm : 0;
  const scaleBarPx = pxPerCm ? scaleBarCm * pxPerCm : 0;
  const sbY = imageHeight - margin;
  const sbX = margin;
  const ecH = labelSize * 0.6;

  // Share: render SVG to canvas then share as PNG
  const handleShare = useCallback(async () => {
    const svg = svgRef.current;
    if (!svg) return;

    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(svg);
    const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    const img = new Image();
    img.onload = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = imageWidth;
      canvas.height = imageHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);

      canvas.toBlob(async (blob) => {
        if (!blob) return;
        const file = new File([blob], 'mesure-cloque.png', { type: 'image/png' });

        if (navigator.share && navigator.canShare?.({ files: [file] })) {
          try {
            await navigator.share({ files: [file], title: 'Mesure Cloque' });
          } catch {
            // User cancelled or share failed — fallback to download
            downloadBlob(blob);
          }
        } else {
          downloadBlob(blob);
        }
      }, 'image/png');
    };
    img.src = url;
  }, [imageWidth, imageHeight]);

  return (
    <div className="result-screen">
      <div className="result-preview">
        <svg ref={svgRef} viewBox={`0 0 ${imageWidth} ${imageHeight}`} className="result-svg" xmlns="http://www.w3.org/2000/svg">
          <image href={imageSrc} width={imageWidth} height={imageHeight} />

          {/* Colored polygon overlay */}
          <polygon
            points={points.map(p => `${p.x},${p.y}`).join(' ')}
            fill={polyFill}
            stroke={polyColor}
            strokeWidth={sw * 2}
            strokeLinejoin="round"
          />

          {/* Area badge below polygon */}
          <rect
            x={badgeX}
            y={badgeY}
            width={badgeW}
            height={badgeH}
            rx={badgeH / 4}
            fill={badgeBg}
          />
          <text
            x={cx}
            y={badgeY + badgeH / 2 + labelSize * 0.35}
            textAnchor="middle"
            fill="white"
            fontSize={labelSize}
            fontWeight="700"
            fontFamily="system-ui, -apple-system, sans-serif"
          >
            {areaDisplay}
          </text>

          {/* Scale bar (bottom-left) */}
          {pxPerCm && scaleBarPx > 0 && (
            <g>
              {/* Shadow */}
              <line x1={sbX} y1={sbY} x2={sbX + scaleBarPx} y2={sbY}
                stroke="rgba(0,0,0,0.5)" strokeWidth={sw * 4} strokeLinecap="round" />
              {/* Main bar */}
              <line x1={sbX} y1={sbY} x2={sbX + scaleBarPx} y2={sbY}
                stroke="white" strokeWidth={sw * 2} strokeLinecap="round" />
              {/* Left endcap */}
              <line x1={sbX} y1={sbY - ecH / 2} x2={sbX} y2={sbY + ecH / 2}
                stroke="white" strokeWidth={sw * 2} strokeLinecap="round" />
              {/* Right endcap */}
              <line x1={sbX + scaleBarPx} y1={sbY - ecH / 2} x2={sbX + scaleBarPx} y2={sbY + ecH / 2}
                stroke="white" strokeWidth={sw * 2} strokeLinecap="round" />
              {/* Scale label */}
              <text
                x={sbX + scaleBarPx / 2}
                y={sbY - ecH}
                textAnchor="middle"
                fill="white"
                fontSize={scaleBarLabelSize}
                fontWeight="700"
                fontFamily="system-ui, -apple-system, sans-serif"
                stroke="rgba(0,0,0,0.6)"
                strokeWidth={sw * 0.8}
                paintOrder="stroke"
              >
                {scaleBarCm.toFixed(0)} cm
              </text>
            </g>
          )}
        </svg>
      </div>

      <div className="result-footer">
        <div className="result-buttons">
          <button className="btn btn-primary" onClick={onRestart}>
            Nouvelle mesure
          </button>
          <button className="btn btn-secondary" onClick={handleShare}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M4 12V14C4 14.5523 4.44772 15 5 15H13C13.5523 15 14 14.5523 14 14V12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M9 3V11M9 3L6 6M9 3L12 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Partager
          </button>
        </div>
      </div>
    </div>
  );
}

function downloadBlob(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'mesure-cloque.png';
  a.click();
  URL.revokeObjectURL(url);
}
