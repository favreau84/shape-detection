import { env, AutoModel, AutoProcessor, RawImage } from '@xenova/transformers';

// Configure transformers.js to not use local models
env.allowLocalModels = false;

let model: Awaited<ReturnType<typeof AutoModel.from_pretrained>> | null = null;
let processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>> | null = null;

async function loadModel() {
  if (!model) {
    self.postMessage({ type: 'status', message: 'Chargement du modèle...' });
    processor = await AutoProcessor.from_pretrained('Xenova/slimsam-77-uniform');
    model = await AutoModel.from_pretrained('Xenova/slimsam-77-uniform');
    self.postMessage({ type: 'status', message: 'Modèle chargé' });
  }
}

function maskToPolygon(mask: Float32Array | Uint8Array, width: number, height: number): { x: number; y: number }[] {
  // Find contour of binary mask using simple boundary tracing
  // First, create a 2D grid
  const grid: boolean[][] = [];
  for (let y = 0; y < height; y++) {
    grid[y] = [];
    for (let x = 0; x < width; x++) {
      grid[y][x] = mask[y * width + x] > 0.5;
    }
  }

  // Find boundary pixels
  const boundaryPoints: { x: number; y: number }[] = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (grid[y][x]) {
        // Check if on boundary (has at least one non-mask neighbor)
        if (!grid[y - 1][x] || !grid[y + 1][x] || !grid[y][x - 1] || !grid[y][x + 1]) {
          boundaryPoints.push({ x, y });
        }
      }
    }
  }

  if (boundaryPoints.length === 0) return [];

  // Simplify using Ramer-Douglas-Peucker on the convex hull
  // First sort points by angle from centroid for ordering
  const cx = boundaryPoints.reduce((s, p) => s + p.x, 0) / boundaryPoints.length;
  const cy = boundaryPoints.reduce((s, p) => s + p.y, 0) / boundaryPoints.length;

  boundaryPoints.sort((a, b) => {
    return Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx);
  });

  // Sample uniformly to reduce points
  const maxPoints = 200;
  const step = Math.max(1, Math.floor(boundaryPoints.length / maxPoints));
  const sampled = boundaryPoints.filter((_, i) => i % step === 0);

  // Apply RDP simplification
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

self.onmessage = async (e: MessageEvent) => {
  const { type, imageData, width, height } = e.data;

  if (type === 'segment') {
    try {
      await loadModel();

      self.postMessage({ type: 'status', message: 'Segmentation en cours...' });

      // Create RawImage from the image data
      const image = new RawImage(new Uint8ClampedArray(imageData), width, height, 4);

      // Use center point as prompt (assume blister is roughly centered)
      const inputPoints = [[[width / 2, height / 2]]];
      const inputLabels = [[1]];

      // Process inputs
      const inputs = await processor!(image);
      const processedInputs = {
        ...inputs,
        input_points: inputPoints,
        input_labels: inputLabels,
      };

      // Run model
      const outputs = await model!(processedInputs);
      const maskData = outputs.pred_masks.data as Float32Array;

      // The mask is at the model's output resolution, need to handle that
      // Get the mask dimensions from the output
      const maskShape = outputs.pred_masks.dims;
      const maskH = maskShape[maskShape.length - 2];
      const maskW = maskShape[maskShape.length - 1];

      // Convert mask to polygon
      const polygon = maskToPolygon(maskData, maskW, maskH);

      // Scale polygon points back to original image dimensions
      const scaleX = width / maskW;
      const scaleY = height / maskH;
      const scaledPolygon = polygon.map(p => ({
        x: Math.round(p.x * scaleX),
        y: Math.round(p.y * scaleY),
      }));

      self.postMessage({
        type: 'result',
        polygon: scaledPolygon,
      });
    } catch (error) {
      self.postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : 'Erreur de segmentation',
      });
    }
  }
};
