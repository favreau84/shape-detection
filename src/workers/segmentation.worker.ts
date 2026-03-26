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

// ─── Convex Hull (Graham Scan) ───

function cross(o: Pt, a: Pt, b: Pt): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function convexHull(points: Pt[]): Pt[] {
  if (points.length <= 3) return points;

  // Sort by x, then y
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const n = sorted.length;

  // Build lower hull
  const lower: Pt[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  // Build upper hull
  const upper: Pt[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  // Remove last point of each half because it's repeated
  lower.pop();
  upper.pop();

  return [...lower, ...upper];
}

// ─── Mask → boundary points ───

function maskToBoundary(mask: Float32Array | Uint8Array, width: number, height: number): Pt[] {
  const boundaryPoints: Pt[] = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (mask[y * width + x] > 0.5) {
        if (
          mask[(y - 1) * width + x] <= 0.5 ||
          mask[(y + 1) * width + x] <= 0.5 ||
          mask[y * width + (x - 1)] <= 0.5 ||
          mask[y * width + (x + 1)] <= 0.5
        ) {
          boundaryPoints.push({ x, y });
        }
      }
    }
  }
  return boundaryPoints;
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

function simplifyToMax(points: Pt[], maxPoints: number): Pt[] {
  let eps = 2;
  let result = rdpSimplify(points, eps);
  while (result.length > maxPoints && eps < 500) {
    eps *= 1.5;
    result = rdpSimplify(points, eps);
  }
  return result;
}

// ─── Card detection: min-area rectangle ───

function minAreaRect(boundary: Pt[]): { corners: Pt[]; widthPx: number; heightPx: number } | null {
  const hull = convexHull(boundary);
  if (hull.length < 4) return null;

  let bestArea = Infinity;
  let bestRect: { corners: Pt[]; w: number; h: number } | null = null;

  for (let deg = 0; deg < 90; deg += 0.5) {
    const rad = (deg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    let minU = Infinity, maxU = -Infinity;
    let minV = Infinity, maxV = -Infinity;

    for (const p of hull) {
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

  return {
    corners: bestRect.corners,
    widthPx: Math.max(bestRect.w, bestRect.h),
    heightPx: Math.min(bestRect.w, bestRect.h),
  };
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

// ─── Run SAM ───

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

// ─── Shape detection ───

async function detectShape(imageData: ArrayBuffer, origWidth: number, origHeight: number) {
  self.postMessage({ type: 'status', message: 'Détection de la forme...' });

  const { maskData, maskW, maskH, w, h, scaleX, scaleY } = await runSam(imageData, origWidth, origHeight);

  const boundary = maskToBoundary(maskData, maskW, maskH);
  if (boundary.length < 10) {
    throw new Error('Aucune forme détectée');
  }

  // Convex hull then simplify
  const hull = convexHull(boundary);
  const simplified = simplifyToMax(hull, 40);

  const mScaleX = w / maskW;
  const mScaleY = h / maskH;
  const polygon = simplified.map(p => ({
    x: Math.round(p.x * mScaleX * scaleX),
    y: Math.round(p.y * mScaleY * scaleY),
  }));

  return polygon;
}

// ─── Card detection ───

const CARD_WIDTH_CM = 8.56;
const CARD_HEIGHT_CM = 5.398;

async function detectCard(imageData: ArrayBuffer, origWidth: number, origHeight: number) {
  self.postMessage({ type: 'status', message: 'Détection de la carte...' });

  const { maskData, maskW, maskH, w, h, scaleX, scaleY } = await runSam(imageData, origWidth, origHeight);

  const boundary = maskToBoundary(maskData, maskW, maskH);
  if (boundary.length < 10) {
    throw new Error('Aucune carte détectée');
  }

  const rect = minAreaRect(boundary);
  if (!rect) {
    throw new Error('Aucune carte détectée');
  }

  const mScaleX = w / maskW;
  const mScaleY = h / maskH;
  const corners = rect.corners.map(p => ({
    x: Math.round(p.x * mScaleX * scaleX),
    y: Math.round(p.y * mScaleY * scaleY),
  }));

  const diagPx = Math.sqrt(
    (corners[0].x - corners[2].x) ** 2 + (corners[0].y - corners[2].y) ** 2
  );
  const diagCm = Math.sqrt(CARD_WIDTH_CM ** 2 + CARD_HEIGHT_CM ** 2);

  // Check aspect ratio
  const widthPx = rect.widthPx * mScaleX * scaleX;
  const heightPx = rect.heightPx * mScaleY * scaleY;
  const detectedRatio = widthPx / heightPx;
  const cardRatio = CARD_WIDTH_CM / CARD_HEIGHT_CM;
  const isCardLike = detectedRatio > cardRatio * 0.6 && detectedRatio < cardRatio * 1.4;

  return {
    corners,
    p1: corners[0],
    p2: corners[2],
    diagPx,
    diagCm,
    isCardLike,
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
