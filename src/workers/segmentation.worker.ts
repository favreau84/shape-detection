import { env, SamModel, AutoProcessor, RawImage } from '@xenova/transformers';

env.allowLocalModels = false;

let model: Awaited<ReturnType<typeof SamModel.from_pretrained>> | null = null;
let processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>> | null = null;

async function loadModel() {
  if (!model) {
    self.postMessage({ type: 'status', message: 'Chargement du modèle...' });
    processor = await AutoProcessor.from_pretrained('Xenova/slimsam-77-uniform');
    model = await SamModel.from_pretrained('Xenova/slimsam-77-uniform');
    self.postMessage({ type: 'status', message: 'Modèle chargé' });
  }
}

type Pt = { x: number; y: number };

// ─── Mask → polygon contour ───

function maskToContour(mask: Float32Array | Uint8Array, width: number, height: number): Pt[] {
  const grid: boolean[][] = [];
  for (let y = 0; y < height; y++) {
    grid[y] = [];
    for (let x = 0; x < width; x++) {
      grid[y][x] = mask[y * width + x] > 0.5;
    }
  }

  const boundaryPoints: Pt[] = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (grid[y][x]) {
        if (!grid[y - 1][x] || !grid[y + 1][x] || !grid[y][x - 1] || !grid[y][x + 1]) {
          boundaryPoints.push({ x, y });
        }
      }
    }
  }

  if (boundaryPoints.length === 0) return [];

  // Sort by angle from centroid
  const cx = boundaryPoints.reduce((s, p) => s + p.x, 0) / boundaryPoints.length;
  const cy = boundaryPoints.reduce((s, p) => s + p.y, 0) / boundaryPoints.length;
  boundaryPoints.sort((a, b) =>
    Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx)
  );

  // Uniform sampling then RDP
  const maxSample = 300;
  const step = Math.max(1, Math.floor(boundaryPoints.length / maxSample));
  const sampled = boundaryPoints.filter((_, i) => i % step === 0);

  return sampled;
}

// ─── RDP simplification ───

function rdpSimplify(points: Pt[], epsilon: number): Pt[] {
  if (points.length <= 2) return points;

  let maxDist = 0;
  let maxIdx = 0;
  const start = points[0];
  const end = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDist(points[i], start, end);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }

  if (maxDist > epsilon) {
    const left = rdpSimplify(points.slice(0, maxIdx + 1), epsilon);
    const right = rdpSimplify(points.slice(maxIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }

  return [start, end];
}

function perpendicularDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2);
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
}

/**
 * Simplify to at most maxPoints using increasing epsilon.
 */
function simplifyToMax(points: Pt[], maxPoints: number): Pt[] {
  let eps = 2;
  let result = rdpSimplify(points, eps);
  while (result.length > maxPoints && eps < 200) {
    eps *= 1.5;
    result = rdpSimplify(points, eps);
  }
  return result;
}

// ─── Card detection: find min-area rectangle from mask ───

function maskToMinAreaRect(mask: Float32Array | Uint8Array, width: number, height: number): { corners: Pt[]; widthPx: number; heightPx: number } | null {
  // Get contour
  const contour = maskToContour(mask, width, height);
  if (contour.length < 10) return null;

  // Rotating calipers approximation:
  // Try many angles, find the one that gives the smallest bounding box
  let bestArea = Infinity;
  let bestRect: { corners: Pt[]; w: number; h: number } | null = null;

  for (let deg = 0; deg < 90; deg += 1) {
    const rad = (deg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    let minU = Infinity, maxU = -Infinity;
    let minV = Infinity, maxV = -Infinity;

    for (const p of contour) {
      const u = p.x * cos + p.y * sin;
      const v = -p.x * sin + p.y * cos;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }

    const w = maxU - minU;
    const h = maxV - minV;
    const area = w * h;

    if (area < bestArea) {
      bestArea = area;
      // Compute 4 corners in original space
      const corners: Pt[] = [
        { x: minU * cos - minV * sin, y: minU * sin + minV * cos },
        { x: maxU * cos - minV * sin, y: maxU * sin + minV * cos },
        { x: maxU * cos - maxV * sin, y: maxU * sin + maxV * cos },
        { x: minU * cos - maxV * sin, y: minU * sin + maxV * cos },
      ];
      bestRect = { corners, w, h };
    }
  }

  if (!bestRect) return null;

  // Ensure width > height (landscape card orientation)
  const widthPx = Math.max(bestRect.w, bestRect.h);
  const heightPx = Math.min(bestRect.w, bestRect.h);

  return { corners: bestRect.corners, widthPx, heightPx };
}

// ─── Downscale ───

function downscaleImageData(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  maxDim: number
): { data: Uint8ClampedArray; width: number; height: number; scaleX: number; scaleY: number } {
  if (width <= maxDim && height <= maxDim) {
    return { data, width, height, scaleX: 1, scaleY: 1 };
  }
  const ratio = Math.min(maxDim / width, maxDim / height);
  const nw = Math.round(width * ratio);
  const nh = Math.round(height * ratio);
  const out = new Uint8ClampedArray(nw * nh * 4);

  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      const sx = Math.min(Math.floor(x / ratio), width - 1);
      const sy = Math.min(Math.floor(y / ratio), height - 1);
      const si = (sy * width + sx) * 4;
      const di = (y * nw + x) * 4;
      out[di] = data[si];
      out[di + 1] = data[si + 1];
      out[di + 2] = data[si + 2];
      out[di + 3] = data[si + 3];
    }
  }
  return { data: out, width: nw, height: nh, scaleX: width / nw, scaleY: height / nh };
}

// ─── Run SAM and get mask ───

async function runSam(imageData: ArrayBuffer, origWidth: number, origHeight: number) {
  await loadModel();

  const rawPixels = new Uint8ClampedArray(imageData);
  const { data: scaledPixels, width: w, height: h, scaleX, scaleY } = downscaleImageData(rawPixels, origWidth, origHeight, 512);

  const image = new RawImage(scaledPixels, w, h, 4);
  const inputs = await processor!(image, [[[w / 2, h / 2]]], [[1]]);
  const outputs = await model!(inputs);

  const maskData = outputs.pred_masks.data as Float32Array;
  const maskShape = outputs.pred_masks.dims;
  const maskH = maskShape[maskShape.length - 2];
  const maskW = maskShape[maskShape.length - 1];

  return { maskData, maskW, maskH, w, h, scaleX, scaleY };
}

// ─── Shape detection: blob polygon ≤50 points ───

async function detectShape(imageData: ArrayBuffer, origWidth: number, origHeight: number) {
  self.postMessage({ type: 'status', message: 'Détection de la forme...' });

  const { maskData, maskW, maskH, w, h, scaleX, scaleY } = await runSam(imageData, origWidth, origHeight);

  const contour = maskToContour(maskData, maskW, maskH);
  if (contour.length === 0) {
    throw new Error('Aucune forme détectée');
  }

  const simplified = simplifyToMax(contour, 40);

  // Scale back: mask → downscaled → original
  const mScaleX = w / maskW;
  const mScaleY = h / maskH;
  const polygon = simplified.map(p => ({
    x: Math.round(p.x * mScaleX * scaleX),
    y: Math.round(p.y * mScaleY * scaleY),
  }));

  return polygon;
}

// ─── Card detection: find rectangle + compute scale ───

// Standard card: 85.6mm × 53.98mm
const CARD_WIDTH_CM = 8.56;
const CARD_HEIGHT_CM = 5.398;

async function detectCard(imageData: ArrayBuffer, origWidth: number, origHeight: number) {
  self.postMessage({ type: 'status', message: 'Détection de la carte...' });

  const { maskData, maskW, maskH, w, h, scaleX, scaleY } = await runSam(imageData, origWidth, origHeight);

  const rect = maskToMinAreaRect(maskData, maskW, maskH);
  if (!rect) {
    throw new Error('Aucune carte détectée');
  }

  // Scale corners back to original image
  const mScaleX = w / maskW;
  const mScaleY = h / maskH;
  const corners = rect.corners.map(p => ({
    x: Math.round(p.x * mScaleX * scaleX),
    y: Math.round(p.y * mScaleY * scaleY),
  }));

  // Compute diagonal in original image pixels
  const widthPx = rect.widthPx * mScaleX * scaleX;
  const heightPx = rect.heightPx * mScaleY * scaleY;

  // Use the longest side of the detected rect to determine scale
  // Card aspect ratio: 85.6 / 53.98 ≈ 1.586
  const detectedRatio = widthPx / heightPx;
  const cardRatio = CARD_WIDTH_CM / CARD_HEIGHT_CM;

  // Check if aspect ratio is roughly card-like (within 40% tolerance)
  const ratioMatch = detectedRatio > cardRatio * 0.6 && detectedRatio < cardRatio * 1.4;

  // Use the diagonal for most robust scale reference
  const diagPx = Math.sqrt(widthPx * widthPx + heightPx * heightPx);
  const diagCm = Math.sqrt(CARD_WIDTH_CM * CARD_WIDTH_CM + CARD_HEIGHT_CM * CARD_HEIGHT_CM);

  // Pick two opposite corners for the scale line
  const p1 = corners[0];
  const p2 = corners[2];

  return {
    corners,
    p1,
    p2,
    diagPx,
    diagCm,
    isCardLike: ratioMatch,
  };
}

// ─── Message handler ───

self.onmessage = async (e: MessageEvent) => {
  const { type, imageData, width, height, mode } = e.data;

  if (type === 'segment') {
    try {
      await loadModel();

      if (mode === 'scale') {
        const card = await detectCard(imageData, width, height);
        self.postMessage({
          type: 'card-result',
          corners: card.corners,
          p1: card.p1,
          p2: card.p2,
          diagCm: card.diagCm,
          isCardLike: card.isCardLike,
        });
      } else {
        const polygon = await detectShape(imageData, width, height);
        self.postMessage({ type: 'shape-result', polygon });
      }
    } catch (error) {
      console.error('Segmentation failed:', error);
      self.postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : 'Erreur de segmentation',
      });
    }
  }
};
