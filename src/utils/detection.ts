/* eslint-disable @typescript-eslint/no-explicit-any */

import type { Point } from '../types';
import { waitForOpenCV } from './opencv-loader';

declare const cv: any;

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

// ─── Yellow ruler detection with autocorrelation-based scale ───

export interface RulerDetection {
  p1: Point;
  p2: Point;
  distanceCm: number;
}

/**
 * Autocorrelation on a 1D signal to find dominant period.
 */
function findPeriodByAutocorrelation(signal: number[], minLag: number, maxLag: number): number | null {
  // Normalize signal (subtract mean)
  const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
  const centered = signal.map(v => v - mean);

  let bestLag = 0;
  let bestScore = -Infinity;

  for (let lag = minLag; lag <= Math.min(maxLag, centered.length / 2); lag++) {
    let sum = 0;
    for (let i = 0; i < centered.length - lag; i++) {
      sum += centered[i] * centered[i + lag];
    }
    if (sum > bestScore) {
      bestScore = sum;
      bestLag = lag;
    }
  }

  // Validate: the autocorrelation peak should be significantly positive
  if (bestScore <= 0 || bestLag <= minLag) return null;
  return bestLag;
}

export async function detectRuler(dataUrl: string): Promise<RulerDetection | null> {
  await waitForOpenCV();

  const { mat } = await dataUrlToMat(dataUrl);
  const rgb = new cv.Mat();
  cv.cvtColor(mat, rgb, cv.COLOR_RGBA2RGB);
  const hsvMat = new cv.Mat();
  cv.cvtColor(rgb, hsvMat, cv.COLOR_RGB2HSV);

  // Yellow range in HSV
  const low = new cv.Mat(hsvMat.rows, hsvMat.cols, hsvMat.type(), [18, 80, 120, 0]);
  const high = new cv.Mat(hsvMat.rows, hsvMat.cols, hsvMat.type(), [40, 255, 255, 255]);
  const yellowMask = new cv.Mat();
  cv.inRange(hsvMat, low, high, yellowMask);

  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(7, 7));
  cv.morphologyEx(yellowMask, yellowMask, cv.MORPH_CLOSE, kernel);
  cv.morphologyEx(yellowMask, yellowMask, cv.MORPH_OPEN, kernel);

  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(yellowMask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  let maxArea = 0;
  let maxIdx = -1;
  for (let i = 0; i < contours.size(); i++) {
    const area = cv.contourArea(contours.get(i));
    if (area > maxArea) { maxArea = area; maxIdx = i; }
  }

  let result: RulerDetection | null = null;

  if (maxIdx >= 0 && maxArea > 500) {
    const rect = cv.minAreaRect(contours.get(maxIdx));
    const cx = rect.center.x;
    const cy = rect.center.y;
    const w = rect.size.width;
    const h = rect.size.height;
    const angle = rect.angle;

    let longHalf: number;
    let rad: number;
    if (w >= h) {
      longHalf = w / 2;
      rad = (angle * Math.PI) / 180;
    } else {
      longHalf = h / 2;
      rad = ((angle + 90) * Math.PI) / 180;
    }

    const axisX = Math.cos(rad);
    const axisY = Math.sin(rad);

    // ─── Detect tick marks via projection + autocorrelation ───
    const gray = new cv.Mat();
    cv.cvtColor(rgb, gray, cv.COLOR_RGB2GRAY);

    const darkThresh = new cv.Mat();
    cv.threshold(gray, darkThresh, 80, 255, cv.THRESH_BINARY_INV);

    const tickMask = new cv.Mat();
    cv.bitwise_and(darkThresh, yellowMask, tickMask);

    // Project dark pixels onto the ruler's long axis → build 1D histogram
    const projections: number[] = [];
    for (let py = 0; py < tickMask.rows; py++) {
      for (let px = 0; px < tickMask.cols; px++) {
        if (tickMask.ucharAt(py, px) > 0) {
          projections.push((px - cx) * axisX + (py - cy) * axisY);
        }
      }
    }

    let pxPerCm: number | null = null;

    if (projections.length > 100) {
      const minProj = Math.min(...projections);
      const maxProj = Math.max(...projections);
      const range = maxProj - minProj;
      // Use ~1px bins
      const binCount = Math.max(10, Math.round(range));
      const histogram = new Array(binCount).fill(0);
      for (const p of projections) {
        const bin = Math.min(binCount - 1, Math.max(0, Math.floor(p - minProj)));
        histogram[bin]++;
      }

      // Smooth heavily to suppress noise from numbers
      const smoothed = smoothArray(histogram, 5);

      // Autocorrelation: find the dominant period
      // For a typical ruler on a phone photo, 1cm ≈ 20-200 px
      const period = findPeriodByAutocorrelation(smoothed, 15, Math.min(300, Math.floor(binCount / 2)));

      if (period) {
        pxPerCm = period;
      }
    }

    gray.delete();
    darkThresh.delete();
    tickMask.delete();

    if (pxPerCm && pxPerCm > 10) {
      const rulerLengthCm = (longHalf * 2) / pxPerCm;
      let segmentCm = 10;
      if (rulerLengthCm < 12) segmentCm = 5;
      if (rulerLengthCm < 6) segmentCm = 3;
      if (rulerLengthCm < 4) segmentCm = 2;

      const segmentHalfPx = (segmentCm * pxPerCm) / 2;

      result = {
        p1: { x: Math.round(cx - axisX * segmentHalfPx), y: Math.round(cy - axisY * segmentHalfPx) },
        p2: { x: Math.round(cx + axisX * segmentHalfPx), y: Math.round(cy + axisY * segmentHalfPx) },
        distanceCm: segmentCm,
      };
    } else {
      result = {
        p1: { x: Math.round(cx - axisX * longHalf * 0.8), y: Math.round(cy - axisY * longHalf * 0.8) },
        p2: { x: Math.round(cx + axisX * longHalf * 0.8), y: Math.round(cy + axisY * longHalf * 0.8) },
        distanceCm: 0,
      };
    }

    if (result.p1.x > result.p2.x) {
      const tmp = result.p1; result.p1 = result.p2; result.p2 = tmp;
    }
  }

  mat.delete(); rgb.delete(); hsvMat.delete(); low.delete(); high.delete();
  yellowMask.delete(); kernel.delete(); contours.delete(); hierarchy.delete();

  return result;
}

function smoothArray(arr: number[], radius: number): number[] {
  const result = new Array(arr.length).fill(0);
  for (let i = 0; i < arr.length; i++) {
    let sum = 0, count = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(arr.length - 1, i + radius); j++) {
      sum += arr[j]; count++;
    }
    result[i] = sum / count;
  }
  return result;
}

// ─── Black contour detection ───
// Targets a black marker outline drawn around a blister.
// Strategy: hard threshold for very dark pixels, heavy morphology to fill
// the ring into a solid blob, then find the largest blob-like contour
// that overlaps with the center of the image.

export async function detectBlackContour(dataUrl: string): Promise<Point[] | null> {
  await waitForOpenCV();

  const { mat } = await dataUrlToMat(dataUrl);
  const imgW = mat.cols;
  const imgH = mat.rows;

  const gray = new cv.Mat();
  cv.cvtColor(mat, gray, cv.COLOR_RGBA2GRAY);

  const blurred = new cv.Mat();
  cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);

  // Hard threshold: detect only very dark pixels (the black marker)
  const binary = new cv.Mat();
  cv.threshold(blurred, binary, 60, 255, cv.THRESH_BINARY_INV);

  // Heavy morphological closing to fill the marker ring into a solid blob
  const closeKernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(25, 25));
  cv.morphologyEx(binary, binary, cv.MORPH_CLOSE, closeKernel);

  // Remove small noise
  const openKernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5, 5));
  cv.morphologyEx(binary, binary, cv.MORPH_OPEN, openKernel);

  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(binary, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  const imageArea = imgW * imgH;
  // Center zone: contour must overlap with center 60% of image
  const cx1 = imgW * 0.2;
  const cy1 = imgH * 0.2;
  const cx2 = imgW * 0.8;
  const cy2 = imgH * 0.8;

  let bestIdx = -1;
  let bestScore = 0;

  for (let i = 0; i < contours.size(); i++) {
    const cnt = contours.get(i);
    const area = cv.contourArea(cnt);

    // Must be significant but not huge
    if (area < imageArea * 0.002 || area > imageArea * 0.4) continue;

    const perimeter = cv.arcLength(cnt, true);
    const circularity = (4 * Math.PI * area) / (perimeter * perimeter);

    // Must be somewhat blob-shaped
    if (circularity < 0.15) continue;

    // Bounding rect
    const brect = cv.boundingRect(cnt);
    const aspect = Math.max(brect.width, brect.height) / Math.min(brect.width, brect.height);
    if (aspect > 4) continue;

    // Must overlap with center zone
    const bx2 = brect.x + brect.width;
    const by2 = brect.y + brect.height;
    const overlapsCenter = brect.x < cx2 && bx2 > cx1 && brect.y < cy2 && by2 > cy1;
    if (!overlapsCenter) continue;

    // Score: prefer centered, large, round contours
    const centerX = brect.x + brect.width / 2;
    const centerY = brect.y + brect.height / 2;
    const distToCenter = Math.sqrt(
      ((centerX - imgW / 2) / imgW) ** 2 + ((centerY - imgH / 2) / imgH) ** 2
    );
    const centerBonus = 1 - distToCenter; // closer to center = higher

    const score = area * circularity * centerBonus;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  let result: Point[] | null = null;

  if (bestIdx >= 0) {
    const cnt = contours.get(bestIdx);
    const perimeter = cv.arcLength(cnt, true);

    const approx = new cv.Mat();
    let epsilon = 0.005 * perimeter;
    cv.approxPolyDP(cnt, approx, epsilon, true);

    while (approx.rows > 50 && epsilon < 0.1 * perimeter) {
      epsilon *= 1.5;
      cv.approxPolyDP(cnt, approx, epsilon, true);
    }

    result = [];
    for (let j = 0; j < approx.rows; j++) {
      result.push({ x: approx.intAt(j, 0), y: approx.intAt(j, 1) });
    }

    approx.delete();
  }

  mat.delete(); gray.delete(); blurred.delete(); binary.delete();
  closeKernel.delete(); openKernel.delete(); contours.delete(); hierarchy.delete();

  return result;
}
