import type { Point } from '../types';

/**
 * Shoelace formula for polygon area in pixels².
 */
export function computePolygonArea(points: Point[]): number {
  const n = points.length;
  if (n < 3) return 0;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }
  return Math.abs(area) / 2;
}

export function distance(a: Point, b: Point): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

export function screenToImage(
  screenX: number,
  screenY: number,
  offsetX: number,
  offsetY: number,
  scale: number
): Point {
  return {
    x: (screenX - offsetX) / scale,
    y: (screenY - offsetY) / scale,
  };
}

export function imageToScreen(
  imgX: number,
  imgY: number,
  offsetX: number,
  offsetY: number,
  scale: number
): Point {
  return {
    x: imgX * scale + offsetX,
    y: imgY * scale + offsetY,
  };
}

/**
 * Compute px-per-cm ratio from two reference points and a known distance in cm.
 */
export function computePxPerCm(p1: Point, p2: Point, distanceCm: number): number {
  const distPx = distance(p1, p2);
  return distPx / distanceCm;
}

/**
 * Format area in cm².
 */
export function formatAreaCm2(areaPx: number, pxPerCm: number): string {
  const areaCm2 = areaPx / (pxPerCm * pxPerCm);
  if (areaCm2 < 1) {
    return `${(areaCm2 * 100).toFixed(1)} mm²`;
  }
  return `${areaCm2.toFixed(2)} cm²`;
}

/**
 * Format area when no scale is set (px only).
 */
export function formatAreaPx(areaPx: number): string {
  return `${Math.round(areaPx).toLocaleString('fr-FR')} px²`;
}

// Standard credit card dimensions: 85.6mm x 53.98mm
export const CREDIT_CARD_WIDTH_CM = 8.56;
export const CREDIT_CARD_HEIGHT_CM = 5.398;
export const CREDIT_CARD_DIAGONAL_CM = Math.sqrt(CREDIT_CARD_WIDTH_CM ** 2 + CREDIT_CARD_HEIGHT_CM ** 2);
