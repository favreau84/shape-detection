/* eslint-disable @typescript-eslint/no-explicit-any */

import type { Point } from '../types';
import { waitForOpenCV } from './opencv-loader';

declare const cv: any;

/**
 * Load an image data URL into an OpenCV Mat via an offscreen canvas.
 */
function dataUrlToMat(dataUrl: string): Promise<{ mat: any; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const mat = cv.imread(canvas);
      resolve({ mat, width: canvas.width, height: canvas.height });
    };
    img.onerror = () => reject(new Error('Impossible de charger l\'image'));
    img.src = dataUrl;
  });
}

// ─── Yellow ruler detection ───

export async function detectRuler(dataUrl: string): Promise<{ p1: Point; p2: Point } | null> {
  await waitForOpenCV();

  const { mat } = await dataUrlToMat(dataUrl);
  const hsv = new cv.Mat();
  cv.cvtColor(mat, hsv, cv.COLOR_RGBA2RGB);
  const hsvMat = new cv.Mat();
  cv.cvtColor(hsv, hsvMat, cv.COLOR_RGB2HSV);

  // Yellow range in HSV (covers measuring tape yellow)
  const low = new cv.Mat(hsvMat.rows, hsvMat.cols, hsvMat.type(), [18, 80, 120, 0]);
  const high = new cv.Mat(hsvMat.rows, hsvMat.cols, hsvMat.type(), [40, 255, 255, 255]);
  const mask = new cv.Mat();
  cv.inRange(hsvMat, low, high, mask);

  // Close small gaps
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(7, 7));
  cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, kernel);
  cv.morphologyEx(mask, mask, cv.MORPH_OPEN, kernel);

  // Find contours
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  // Find the largest yellow contour
  let maxArea = 0;
  let maxIdx = -1;
  for (let i = 0; i < contours.size(); i++) {
    const area = cv.contourArea(contours.get(i));
    if (area > maxArea) {
      maxArea = area;
      maxIdx = i;
    }
  }

  let result: { p1: Point; p2: Point } | null = null;

  if (maxIdx >= 0 && maxArea > 500) {
    // Get the min area rectangle
    const rect = cv.minAreaRect(contours.get(maxIdx));

    // vertices is 4 corners. Find the two corners that are farthest apart
    // (the diagonal of the bounding rect = roughly the ruler length)
    // Actually, for a ruler, the long side endpoints are more useful.
    // Sort edges by length, take the longest pair of opposing midpoints...
    // Simpler: use the rect center, size, angle to get endpoints of the long axis
    const cx = rect.center.x;
    const cy = rect.center.y;
    const w = rect.size.width;
    const h = rect.size.height;
    const angle = rect.angle;

    // Determine which dimension is the long one
    let longHalf: number;
    let rad: number;
    if (w >= h) {
      longHalf = w / 2;
      rad = (angle * Math.PI) / 180;
    } else {
      longHalf = h / 2;
      rad = ((angle + 90) * Math.PI) / 180;
    }

    const dx = Math.cos(rad) * longHalf;
    const dy = Math.sin(rad) * longHalf;

    result = {
      p1: { x: Math.round(cx - dx), y: Math.round(cy - dy) },
      p2: { x: Math.round(cx + dx), y: Math.round(cy + dy) },
    };

    // Ensure p1 is the left-most point
    if (result.p1.x > result.p2.x) {
      const tmp = result.p1;
      result.p1 = result.p2;
      result.p2 = tmp;
    }
  }

  // Clean up
  mat.delete();
  hsv.delete();
  hsvMat.delete();
  low.delete();
  high.delete();
  mask.delete();
  kernel.delete();
  contours.delete();
  hierarchy.delete();

  return result;
}

// ─── Black contour detection ───

export async function detectBlackContour(dataUrl: string): Promise<Point[] | null> {
  await waitForOpenCV();

  const { mat } = await dataUrlToMat(dataUrl);

  // Convert to grayscale
  const gray = new cv.Mat();
  cv.cvtColor(mat, gray, cv.COLOR_RGBA2GRAY);

  // Blur to reduce noise
  const blurred = new cv.Mat();
  cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);

  // Adaptive threshold to detect dark lines (the black marker)
  const binary = new cv.Mat();
  cv.adaptiveThreshold(blurred, binary, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 15, 10);

  // Morphology: close gaps in the marker line
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
  cv.morphologyEx(binary, binary, cv.MORPH_CLOSE, kernel);

  // Find contours
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(binary, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  // Find the best contour:
  // - Large enough area
  // - Not too elongated (aspect ratio of bounding rect)
  // - Roughly blob-shaped (not the ruler)
  const imageArea = mat.rows * mat.cols;
  let bestIdx = -1;
  let bestScore = 0;

  for (let i = 0; i < contours.size(); i++) {
    const cnt = contours.get(i);
    const area = cv.contourArea(cnt);

    // Skip very small contours (noise) and very large ones (background)
    if (area < imageArea * 0.001 || area > imageArea * 0.5) continue;

    const perimeter = cv.arcLength(cnt, true);
    // Circularity: 4π × area / perimeter²  (1 = perfect circle)
    const circularity = (4 * Math.PI * area) / (perimeter * perimeter);

    // We want blob-like contours (circularity > 0.2)
    if (circularity < 0.1) continue;

    // Bounding rect aspect ratio
    const brect = cv.boundingRect(cnt);
    const aspect = Math.max(brect.width, brect.height) / Math.min(brect.width, brect.height);

    // Skip very elongated shapes (likely the ruler)
    if (aspect > 5) continue;

    // Score: prefer larger area with decent circularity
    const score = area * circularity;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  let result: Point[] | null = null;

  if (bestIdx >= 0) {
    const cnt = contours.get(bestIdx);
    const perimeter = cv.arcLength(cnt, true);

    // Simplify with approxPolyDP
    const approx = new cv.Mat();
    let epsilon = 0.005 * perimeter;
    cv.approxPolyDP(cnt, approx, epsilon, true);

    // If too many points, increase epsilon
    while (approx.rows > 50 && epsilon < 0.1 * perimeter) {
      epsilon *= 1.5;
      cv.approxPolyDP(cnt, approx, epsilon, true);
    }

    result = [];
    for (let j = 0; j < approx.rows; j++) {
      result.push({
        x: approx.intAt(j, 0),
        y: approx.intAt(j, 1),
      });
    }

    approx.delete();
  }

  // Clean up
  mat.delete();
  gray.delete();
  blurred.delete();
  binary.delete();
  kernel.delete();
  contours.delete();
  hierarchy.delete();

  return result;
}
