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

// ─── Yellow ruler detection with auto-scale ───

export interface RulerDetection {
  p1: Point;
  p2: Point;
  distanceCm: number;
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

  // Close small gaps
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(7, 7));
  cv.morphologyEx(yellowMask, yellowMask, cv.MORPH_CLOSE, kernel);
  cv.morphologyEx(yellowMask, yellowMask, cv.MORPH_OPEN, kernel);

  // Find contours of yellow area
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(yellowMask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  let maxArea = 0;
  let maxIdx = -1;
  for (let i = 0; i < contours.size(); i++) {
    const area = cv.contourArea(contours.get(i));
    if (area > maxArea) {
      maxArea = area;
      maxIdx = i;
    }
  }

  let result: RulerDetection | null = null;

  if (maxIdx >= 0 && maxArea > 500) {
    const rect = cv.minAreaRect(contours.get(maxIdx));
    const cx = rect.center.x;
    const cy = rect.center.y;
    const w = rect.size.width;
    const h = rect.size.height;
    const angle = rect.angle;

    // Ruler long axis direction
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

    // ─── Detect tick marks ───
    // Within the yellow mask, find dark pixels (the tick marks / numbers)
    const gray = new cv.Mat();
    cv.cvtColor(rgb, gray, cv.COLOR_RGB2GRAY);

    // Dark pixels within yellow area = tick marks
    const darkThresh = new cv.Mat();
    cv.threshold(gray, darkThresh, 80, 255, cv.THRESH_BINARY_INV);

    // Intersect with yellow mask (only dark pixels on the ruler)
    const tickMask = new cv.Mat();
    cv.bitwise_and(darkThresh, yellowMask, tickMask);

    // Project each dark pixel onto the ruler's long axis
    // axis direction = (axisX, axisY), origin = (cx, cy)
    // projection = dot((px - cx, py - cy), (axisX, axisY))
    const projections: number[] = [];
    for (let y = 0; y < tickMask.rows; y++) {
      for (let x = 0; x < tickMask.cols; x++) {
        if (tickMask.ucharAt(y, x) > 0) {
          const proj = (x - cx) * axisX + (y - cy) * axisY;
          projections.push(proj);
        }
      }
    }

    let pxPerCm: number | null = null;

    if (projections.length > 100) {
      // Build histogram along the axis
      const minProj = Math.min(...projections);
      const maxProj = Math.max(...projections);
      const range = maxProj - minProj;
      const binCount = Math.round(range);
      if (binCount > 10) {
        const histogram = new Array(binCount).fill(0);
        for (const p of projections) {
          const bin = Math.min(binCount - 1, Math.floor(p - minProj));
          histogram[bin]++;
        }

        // Smooth the histogram
        const smoothed = smoothArray(histogram, 3);

        // Find peaks (local maxima above a threshold)
        const threshold = Math.max(...smoothed) * 0.3;
        const peaks = findPeaks(smoothed, threshold, 8);

        if (peaks.length >= 3) {
          // Compute spacings between consecutive peaks
          const spacings: number[] = [];
          for (let i = 1; i < peaks.length; i++) {
            spacings.push(peaks[i] - peaks[i - 1]);
          }

          // The cm marks should have a regular spacing
          // Find the most common spacing (median)
          spacings.sort((a, b) => a - b);
          const medianSpacing = spacings[Math.floor(spacings.length / 2)];

          // Filter spacings close to the median (within 30%)
          const validSpacings = spacings.filter(
            s => s > medianSpacing * 0.7 && s < medianSpacing * 1.3
          );

          if (validSpacings.length >= 2) {
            pxPerCm = validSpacings.reduce((a, b) => a + b, 0) / validSpacings.length;
          }
        }
      }
    }

    gray.delete();
    darkThresh.delete();
    tickMask.delete();

    if (pxPerCm && pxPerCm > 5) {
      // Auto-calibrated: place a segment of a round cm value
      // Choose a nice distance (5cm or 10cm) that fits within the ruler
      const rulerLengthCm = (longHalf * 2) / pxPerCm;
      let segmentCm = 10;
      if (rulerLengthCm < 12) segmentCm = 5;
      if (rulerLengthCm < 6) segmentCm = 3;
      if (rulerLengthCm < 4) segmentCm = 2;

      const segmentHalfPx = (segmentCm * pxPerCm) / 2;

      result = {
        p1: {
          x: Math.round(cx - axisX * segmentHalfPx),
          y: Math.round(cy - axisY * segmentHalfPx),
        },
        p2: {
          x: Math.round(cx + axisX * segmentHalfPx),
          y: Math.round(cy + axisY * segmentHalfPx),
        },
        distanceCm: segmentCm,
      };
    } else {
      // Fallback: return the full ruler extent, user will need to specify
      result = {
        p1: {
          x: Math.round(cx - axisX * longHalf * 0.8),
          y: Math.round(cy - axisY * longHalf * 0.8),
        },
        p2: {
          x: Math.round(cx + axisX * longHalf * 0.8),
          y: Math.round(cy + axisY * longHalf * 0.8),
        },
        distanceCm: 0, // 0 means "unknown, ask user"
      };
    }

    // Ensure p1 is the left-most point
    if (result.p1.x > result.p2.x) {
      const tmp = result.p1;
      result.p1 = result.p2;
      result.p2 = tmp;
    }
  }

  // Clean up
  mat.delete();
  rgb.delete();
  hsvMat.delete();
  low.delete();
  high.delete();
  yellowMask.delete();
  kernel.delete();
  contours.delete();
  hierarchy.delete();

  return result;
}

function smoothArray(arr: number[], radius: number): number[] {
  const result = new Array(arr.length).fill(0);
  for (let i = 0; i < arr.length; i++) {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(arr.length - 1, i + radius); j++) {
      sum += arr[j];
      count++;
    }
    result[i] = sum / count;
  }
  return result;
}

function findPeaks(arr: number[], threshold: number, minDistance: number): number[] {
  const peaks: number[] = [];
  for (let i = 1; i < arr.length - 1; i++) {
    if (arr[i] > threshold && arr[i] >= arr[i - 1] && arr[i] >= arr[i + 1]) {
      if (peaks.length === 0 || i - peaks[peaks.length - 1] >= minDistance) {
        peaks.push(i);
      }
    }
  }
  return peaks;
}

// ─── Black contour detection ───

export async function detectBlackContour(dataUrl: string): Promise<Point[] | null> {
  await waitForOpenCV();

  const { mat } = await dataUrlToMat(dataUrl);

  const gray = new cv.Mat();
  cv.cvtColor(mat, gray, cv.COLOR_RGBA2GRAY);

  const blurred = new cv.Mat();
  cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);

  const binary = new cv.Mat();
  cv.adaptiveThreshold(blurred, binary, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 15, 10);

  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
  cv.morphologyEx(binary, binary, cv.MORPH_CLOSE, kernel);

  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(binary, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  const imageArea = mat.rows * mat.cols;
  let bestIdx = -1;
  let bestScore = 0;

  for (let i = 0; i < contours.size(); i++) {
    const cnt = contours.get(i);
    const area = cv.contourArea(cnt);

    if (area < imageArea * 0.001 || area > imageArea * 0.5) continue;

    const perimeter = cv.arcLength(cnt, true);
    const circularity = (4 * Math.PI * area) / (perimeter * perimeter);

    if (circularity < 0.1) continue;

    const brect = cv.boundingRect(cnt);
    const aspect = Math.max(brect.width, brect.height) / Math.min(brect.width, brect.height);

    if (aspect > 5) continue;

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

    const approx = new cv.Mat();
    let epsilon = 0.005 * perimeter;
    cv.approxPolyDP(cnt, approx, epsilon, true);

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

  mat.delete();
  gray.delete();
  blurred.delete();
  binary.delete();
  kernel.delete();
  contours.delete();
  hierarchy.delete();

  return result;
}
