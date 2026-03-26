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

// ─── Yellow ruler detection ───

export interface RulerDetection {
  p1: Point;
  p2: Point;
  distanceCm: number;
  axisX: number;
  axisY: number;
}

function findPeriodByAutocorrelation(signal: number[], minLag: number, maxLag: number): number | null {
  const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
  const centered = signal.map(v => v - mean);

  // Normalize by variance at lag 0
  let variance = 0;
  for (const v of centered) variance += v * v;
  if (variance === 0) return null;

  let bestLag = 0;
  let bestScore = -Infinity;

  for (let lag = minLag; lag <= Math.min(maxLag, Math.floor(centered.length / 2)); lag++) {
    let sum = 0;
    for (let i = 0; i < centered.length - lag; i++) {
      sum += centered[i] * centered[i + lag];
    }
    const normalized = sum / variance;
    if (normalized > bestScore) {
      bestScore = normalized;
      bestLag = lag;
    }
  }

  // Must have a clear periodic signal
  if (bestScore < 0.1 || bestLag <= minLag) return null;
  return bestLag;
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

export async function detectRuler(dataUrl: string): Promise<RulerDetection | null> {
  await waitForOpenCV();

  const { mat } = await dataUrlToMat(dataUrl);
  const rgb = new cv.Mat();
  cv.cvtColor(mat, rgb, cv.COLOR_RGBA2RGB);
  const hsvMat = new cv.Mat();
  cv.cvtColor(rgb, hsvMat, cv.COLOR_RGB2HSV);

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
    let shortHalf: number;
    let rad: number;
    if (w >= h) {
      longHalf = w / 2;
      shortHalf = h / 2;
      rad = (angle * Math.PI) / 180;
    } else {
      longHalf = h / 2;
      shortHalf = w / 2;
      rad = ((angle + 90) * Math.PI) / 180;
    }

    // Axis direction: ensure it points to the RIGHT (positive x)
    let axisX = Math.cos(rad);
    let axisY = Math.sin(rad);
    if (axisX < 0) { axisX = -axisX; axisY = -axisY; }

    // ─── Detect tick marks using "tall column" approach ───
    // For each position along the axis, measure how many dark pixels span
    // the ruler's full height at that position.
    // Tick marks (cm) span most of the ruler height.
    // Numbers only span the middle portion.
    const gray = new cv.Mat();
    cv.cvtColor(rgb, gray, cv.COLOR_RGB2GRAY);
    const darkThresh = new cv.Mat();
    cv.threshold(gray, darkThresh, 60, 255, cv.THRESH_BINARY_INV);
    const tickMask = new cv.Mat();
    cv.bitwise_and(darkThresh, yellowMask, tickMask);

    // Build a 1D profile: for each position along the axis, count dark pixels
    // across the ruler width (perpendicular direction)
    const BIN_SIZE = 2; // 2px per bin along axis
    const numBins = Math.ceil((longHalf * 2) / BIN_SIZE);
    const profile = new Array(numBins).fill(0);

    // Also track the "height ratio" — what fraction of the ruler width has dark pixels
    // This helps distinguish tick marks (full height) from numbers (partial)
    const heightProfile = new Array(numBins).fill(0);

    for (let py = 0; py < tickMask.rows; py++) {
      for (let px = 0; px < tickMask.cols; px++) {
        if (tickMask.ucharAt(py, px) > 0) {
          // Project onto axis
          const proj = (px - cx) * axisX + (py - cy) * axisY;
          const bin = Math.floor((proj + longHalf) / BIN_SIZE);
          if (bin >= 0 && bin < numBins) {
            profile[bin]++;
          }
        }
      }
    }

    // Normalize profile by ruler width to get height ratio per bin
    const expectedWidth = shortHalf * 2;
    for (let i = 0; i < numBins; i++) {
      heightProfile[i] = profile[i] / (expectedWidth * BIN_SIZE + 1);
    }

    gray.delete();
    darkThresh.delete();
    tickMask.delete();

    let pxPerCm: number | null = null;

    if (numBins > 20) {
      // Smooth the height profile — tick marks are narrow tall peaks
      const smoothed = smoothArray(heightProfile, 3);

      // Autocorrelation on the profile to find the cm period
      // At BIN_SIZE=2, a 50px/cm ruler has period=25 bins
      const minLagBins = Math.max(5, Math.floor(10 / BIN_SIZE)); // at least 10px
      const maxLagBins = Math.min(200, Math.floor(numBins / 2));

      const period = findPeriodByAutocorrelation(smoothed, minLagBins, maxLagBins);
      if (period) {
        pxPerCm = period * BIN_SIZE; // Convert from bins back to pixels
      }
    }

    // Find the actual leftmost point of yellow band (ruler tip)
    // Scan the ruler contour for the point with the most negative axis projection
    const cnt = contours.get(maxIdx);
    let minAxisProj = Infinity;
    let tipPoint: Point = { x: cx - axisX * longHalf, y: cy - axisY * longHalf };

    for (let j = 0; j < cnt.rows; j++) {
      const px = cnt.intAt(j, 0);
      const py = cnt.intAt(j, 1);
      const proj = (px - cx) * axisX + (py - cy) * axisY;
      if (proj < minAxisProj) {
        minAxisProj = proj;
        // Project back to the ruler center line (not the edge of the contour)
        const axisPos = proj;
        tipPoint = {
          x: cx + axisX * axisPos,
          y: cy + axisY * axisPos,
        };
      }
    }

    if (pxPerCm && pxPerCm > 10) {
      // Choose a round cm value that fits in the ruler
      const rulerLengthCm = (longHalf * 2) / pxPerCm;
      let segmentCm = 10;
      if (rulerLengthCm < 12) segmentCm = 5;
      if (rulerLengthCm < 6) segmentCm = 3;
      if (rulerLengthCm < 4) segmentCm = 2;

      const segmentPx = segmentCm * pxPerCm;

      // p1 = ruler tip (leftmost), p2 = tip + N cm along the axis
      result = {
        p1: { x: Math.round(tipPoint.x), y: Math.round(tipPoint.y) },
        p2: { x: Math.round(tipPoint.x + axisX * segmentPx), y: Math.round(tipPoint.y + axisY * segmentPx) },
        distanceCm: segmentCm,
        axisX, axisY,
      };
    } else {
      // Fallback: return full ruler, user specifies distance
      result = {
        p1: { x: Math.round(tipPoint.x), y: Math.round(tipPoint.y) },
        p2: { x: Math.round(cx + axisX * longHalf * 0.9), y: Math.round(cy + axisY * longHalf * 0.9) },
        distanceCm: 0,
        axisX, axisY,
      };
    }
  }

  mat.delete(); rgb.delete(); hsvMat.delete(); low.delete(); high.delete();
  yellowMask.delete(); kernel.delete(); contours.delete(); hierarchy.delete();

  return result;
}

// ─── Black contour detection ───

export async function detectBlackContour(dataUrl: string): Promise<Point[] | null> {
  await waitForOpenCV();

  const { mat } = await dataUrlToMat(dataUrl);
  const imgW = mat.cols;
  const imgH = mat.rows;

  const gray = new cv.Mat();
  cv.cvtColor(mat, gray, cv.COLOR_RGBA2GRAY);

  const blurred = new cv.Mat();
  cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);

  // Hard threshold for very dark pixels (black marker)
  const binary = new cv.Mat();
  cv.threshold(blurred, binary, 60, 255, cv.THRESH_BINARY_INV);

  // Heavy morphological closing to fill the marker ring into a solid blob
  const closeKernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(25, 25));
  cv.morphologyEx(binary, binary, cv.MORPH_CLOSE, closeKernel);

  const openKernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5, 5));
  cv.morphologyEx(binary, binary, cv.MORPH_OPEN, openKernel);

  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(binary, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  const imageArea = imgW * imgH;
  const cx1 = imgW * 0.2, cy1 = imgH * 0.2;
  const cx2 = imgW * 0.8, cy2 = imgH * 0.8;

  let bestIdx = -1;
  let bestScore = 0;

  for (let i = 0; i < contours.size(); i++) {
    const cnt = contours.get(i);
    const area = cv.contourArea(cnt);

    if (area < imageArea * 0.002 || area > imageArea * 0.4) continue;

    const perimeter = cv.arcLength(cnt, true);
    const circularity = (4 * Math.PI * area) / (perimeter * perimeter);
    if (circularity < 0.15) continue;

    const brect = cv.boundingRect(cnt);
    const aspect = Math.max(brect.width, brect.height) / Math.min(brect.width, brect.height);
    if (aspect > 4) continue;

    const bx2 = brect.x + brect.width;
    const by2 = brect.y + brect.height;
    if (!(brect.x < cx2 && bx2 > cx1 && brect.y < cy2 && by2 > cy1)) continue;

    const centerX = brect.x + brect.width / 2;
    const centerY = brect.y + brect.height / 2;
    const distToCenter = Math.sqrt(
      ((centerX - imgW / 2) / imgW) ** 2 + ((centerY - imgH / 2) / imgH) ** 2
    );
    const centerBonus = 1 - distToCenter;

    const score = area * circularity * centerBonus;
    if (score > bestScore) { bestScore = score; bestIdx = i; }
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
