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

function maskToPolygon(mask: Float32Array | Uint8Array, width: number, height: number): { x: number; y: number }[] {
  const grid: boolean[][] = [];
  for (let y = 0; y < height; y++) {
    grid[y] = [];
    for (let x = 0; x < width; x++) {
      grid[y][x] = mask[y * width + x] > 0.5;
    }
  }

  const boundaryPoints: { x: number; y: number }[] = [];
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

  const cx = boundaryPoints.reduce((s, p) => s + p.x, 0) / boundaryPoints.length;
  const cy = boundaryPoints.reduce((s, p) => s + p.y, 0) / boundaryPoints.length;

  boundaryPoints.sort((a, b) => {
    return Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx);
  });

  const maxPoints = 200;
  const step = Math.max(1, Math.floor(boundaryPoints.length / maxPoints));
  const sampled = boundaryPoints.filter((_, i) => i % step === 0);

  return rdpSimplify(sampled, 3);
}

function rdpSimplify(points: { x: number; y: number }[], epsilon: number): { x: number; y: number }[] {
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

function perpendicularDist(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number }
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2);
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
}

/**
 * Downscale RGBA pixel data to fit within maxDim on the longest side.
 * Returns { data, width, height, scaleX, scaleY }.
 */
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

async function runSegmentation(imageData: ArrayBuffer, origWidth: number, origHeight: number) {
  await loadModel();

  self.postMessage({ type: 'status', message: 'Segmentation en cours...' });

  // Downscale to max 512px to avoid OOM on mobile
  const rawPixels = new Uint8ClampedArray(imageData);
  const { data: scaledPixels, width: w, height: h, scaleX, scaleY } = downscaleImageData(rawPixels, origWidth, origHeight, 512);

  const image = new RawImage(scaledPixels, w, h, 4);

  // Pass input_points and input_labels to the processor (not the model)
  // The processor converts them to properly shaped Tensors and rescales coordinates
  const inputs = await processor!(image, [[[w / 2, h / 2]]], [[1]]);
  const outputs = await model!(inputs);
  const maskData = outputs.pred_masks.data as Float32Array;
  const maskShape = outputs.pred_masks.dims;
  const maskH = maskShape[maskShape.length - 2];
  const maskW = maskShape[maskShape.length - 1];

  const polygon = maskToPolygon(maskData, maskW, maskH);

  // Scale back: mask → downscaled image → original image
  const mScaleX = w / maskW;
  const mScaleY = h / maskH;
  const scaledPolygon = polygon.map(p => ({
    x: Math.round(p.x * mScaleX * scaleX),
    y: Math.round(p.y * mScaleY * scaleY),
  }));

  return scaledPolygon;
}

self.onmessage = async (e: MessageEvent) => {
  const { type, imageData, width, height } = e.data;

  if (type === 'segment') {
    try {
      const polygon = await runSegmentation(imageData, width, height);
      self.postMessage({ type: 'result', polygon });
    } catch (error) {
      console.error('Segmentation failed:', error);
      self.postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : 'Erreur de segmentation',
      });
    }
  }
};
