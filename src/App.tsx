import { useState, useRef, useCallback, useEffect } from 'react';
import type { AppPhase, Point, ScaleRef } from './types';
import { CameraCapture } from './components/CameraCapture';
import { PolygonEditor } from './components/PolygonEditor';
import { ResultView } from './components/ResultView';
import './App.css';

export default function App() {
  const [phase, setPhase] = useState<AppPhase>('capture');
  const [imageSrc, setImageSrc] = useState<string>('');
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [resultPoints, setResultPoints] = useState<Point[]>([]);
  const [resultArea, setResultArea] = useState(0);
  const [scaleRef, setScaleRef] = useState<ScaleRef | null>(null);
  const [detectedPolygon, setDetectedPolygon] = useState<Point[] | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detectionStatus, setDetectionStatus] = useState('Détection en cours...');

  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
    };
  }, []);

  const startSegmentation = useCallback((pixels: ArrayBuffer, w: number, h: number) => {
    const worker = new Worker(
      new URL('./workers/segmentation.worker.ts', import.meta.url),
      { type: 'module' }
    );
    workerRef.current = worker;

    worker.onmessage = (e) => {
      const { type, polygon, message } = e.data;
      if (type === 'status') {
        setDetectionStatus(message);
      } else if (type === 'result') {
        setDetectedPolygon(polygon);
        setDetecting(false);
      } else if (type === 'error') {
        console.warn('Segmentation error:', message);
        setDetecting(false);
        setDetectionStatus('Détection échouée');
      }
    };

    worker.onerror = () => {
      setDetecting(false);
      setDetectionStatus('Détection échouée');
    };

    setDetecting(true);
    setDetectionStatus('Détection en cours...');

    worker.postMessage({ type: 'segment', imageData: pixels, width: w, height: h }, [pixels]);
  }, []);

  const handleCapture = useCallback((dataUrl: string) => {
    // Immediately switch to draw phase to avoid flash
    setImageSrc(dataUrl);
    setDetectedPolygon(null);
    setDetecting(false);
    setScaleRef(null);
    setPhase('draw');

    // Load image for dimensions + segmentation in background
    const img = new Image();
    img.onload = () => {
      setImageSize({ width: img.naturalWidth, height: img.naturalHeight });

      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      startSegmentation(imageData.data.buffer, canvas.width, canvas.height);
    };
    img.src = dataUrl;
  }, [startSegmentation]);

  const handleDone = useCallback((points: Point[], area: number, scale: ScaleRef | null) => {
    setResultPoints(points);
    setResultArea(area);
    setScaleRef(scale);
    setPhase('result');
  }, []);

  const handleRestart = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setPhase('capture');
    setImageSrc('');
    setResultPoints([]);
    setResultArea(0);
    setDetectedPolygon(null);
    setDetecting(false);
    setScaleRef(null);
  }, []);

  const handleBack = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setPhase('capture');
    setDetectedPolygon(null);
    setDetecting(false);
  }, []);

  return (
    <div className="app">
      {phase === 'capture' && <CameraCapture onCapture={handleCapture} />}
      {phase === 'draw' && (
        <PolygonEditor
          imageSrc={imageSrc}
          imageSize={imageSize}
          detectedPolygon={detectedPolygon}
          detecting={detecting}
          detectionStatus={detectionStatus}
          onDone={handleDone}
          onBack={handleBack}
        />
      )}
      {phase === 'result' && (
        <ResultView
          imageSrc={imageSrc}
          points={resultPoints}
          area={resultArea}
          scaleRef={scaleRef}
          imageWidth={imageSize.width}
          imageHeight={imageSize.height}
          onRestart={handleRestart}
        />
      )}
    </div>
  );
}
