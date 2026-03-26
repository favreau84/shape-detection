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

/**
 * Convert screen point to image coordinates given viewport state.
 */
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

/**
 * Convert image point to screen coordinates.
 */
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
 * Format area in px² to a readable string with cm² approximation.
 */
export function formatArea(areaPx: number, totalImagePx: number): string {
  const percentage = (areaPx / totalImagePx) * 100;
  return `${Math.round(areaPx).toLocaleString('fr-FR')} px² (${percentage.toFixed(2)}% de l'image)`;
}
