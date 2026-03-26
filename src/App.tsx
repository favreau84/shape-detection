import { useState, useRef, useCallback, useEffect } from 'react';
import type { AppPhase, Point } from './types';
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
  const [detectedPolygon, setDetectedPolygon] = useState<Point[] | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detectionStatus, setDetectionStatus] = useState('Détection en cours...');

  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
    };
  }, []);

  const startSegmentation = useCallback((dataUrl: string) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

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

      worker.postMessage({
        type: 'segment',
        imageData: imageData.data.buffer,
        width: canvas.width,
        height: canvas.height,
      }, [imageData.data.buffer]);
    };
    img.src = dataUrl;
  }, []);

  const handleCapture = useCallback((dataUrl: string) => {
    setImageSrc(dataUrl);
    setDetectedPolygon(null);
    setDetecting(false);

    const img = new Image();
    img.onload = () => {
      setImageSize({ width: img.naturalWidth, height: img.naturalHeight });
      setPhase('draw');
      startSegmentation(dataUrl);
    };
    img.src = dataUrl;
  }, [startSegmentation]);

  const handleDone = useCallback((points: Point[], area: number) => {
    setResultPoints(points);
    setResultArea(area);
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
          imageWidth={imageSize.width}
          imageHeight={imageSize.height}
          onRestart={handleRestart}
        />
      )}
    </div>
  );
}
