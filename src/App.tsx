import { useState, useRef, useCallback, useEffect } from 'react';
import type { AppPhase, Point, ScaleRef, DrawTool } from './types';
import { CameraCapture } from './components/CameraCapture';
import { PolygonEditor } from './components/PolygonEditor';
import { ResultView } from './components/ResultView';
import './App.css';

interface CardDetection {
  p1: Point;
  p2: Point;
  diagCm: number;
}

export default function App() {
  const [phase, setPhase] = useState<AppPhase>('capture');
  const [imageSrc, setImageSrc] = useState<string>('');
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [resultPoints, setResultPoints] = useState<Point[]>([]);
  const [resultArea, setResultArea] = useState(0);
  const [scaleRef, setScaleRef] = useState<ScaleRef | null>(null);
  const [detectedPolygon, setDetectedPolygon] = useState<Point[] | null>(null);
  const [detectedCard, setDetectedCard] = useState<CardDetection | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detectionStatus, setDetectionStatus] = useState('');

  const workerRef = useRef<Worker | null>(null);
  const imageSrcRef = useRef<string>('');

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
    };
  }, []);

  const startSegmentation = useCallback((mode: DrawTool) => {
    if (!imageSrcRef.current || detecting) return;

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      workerRef.current?.terminate();

      const worker = new Worker(
        new URL('./workers/segmentation.worker.ts', import.meta.url),
        { type: 'module' }
      );
      workerRef.current = worker;

      worker.onmessage = (e) => {
        const data = e.data;
        if (data.type === 'status') {
          setDetectionStatus(data.message);
        } else if (data.type === 'shape-result') {
          setDetectedPolygon(data.polygon);
          setDetecting(false);
        } else if (data.type === 'card-result') {
          setDetectedCard({ p1: data.p1, p2: data.p2, diagCm: data.diagCm });
          setDetecting(false);
        } else if (data.type === 'error') {
          console.warn('Segmentation error:', data.message);
          setDetecting(false);
          setDetectionStatus('Détection échouée');
        }
      };

      worker.onerror = () => {
        setDetecting(false);
        setDetectionStatus('Détection échouée');
      };

      setDetecting(true);
      setDetectionStatus(mode === 'scale' ? 'Détection de la carte...' : 'Détection de la forme...');

      worker.postMessage({
        type: 'segment',
        mode,
        imageData: imageData.data.buffer,
        width: canvas.width,
        height: canvas.height,
      }, [imageData.data.buffer]);
    };
    img.src = imageSrcRef.current;
  }, [detecting]);

  const handleCapture = useCallback((dataUrl: string) => {
    setImageSrc(dataUrl);
    imageSrcRef.current = dataUrl;
    setDetectedPolygon(null);
    setDetectedCard(null);
    setDetecting(false);
    setScaleRef(null);
    setPhase('draw');

    const img = new Image();
    img.onload = () => {
      setImageSize({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.src = dataUrl;
  }, []);

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
    imageSrcRef.current = '';
    setResultPoints([]);
    setResultArea(0);
    setDetectedPolygon(null);
    setDetectedCard(null);
    setDetecting(false);
    setScaleRef(null);
  }, []);

  const handleBack = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setPhase('capture');
    setDetectedPolygon(null);
    setDetectedCard(null);
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
          detectedCard={detectedCard}
          detecting={detecting}
          detectionStatus={detectionStatus}
          onRequestDetection={startSegmentation}
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
