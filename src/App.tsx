import { useState, useCallback } from 'react';
import type { AppPhase, Point, ScaleRef, DrawTool } from './types';
import { CameraCapture } from './components/CameraCapture';
import { PolygonEditor } from './components/PolygonEditor';
import { ResultView } from './components/ResultView';
import { detectRuler, detectBlackContour } from './utils/detection';
import './App.css';

interface RulerResult {
  p1: Point;
  p2: Point;
  distanceCm: number;
}

export default function App() {
  const [phase, setPhase] = useState<AppPhase>('capture');
  const [imageSrc, setImageSrc] = useState<string>('');
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [resultPoints, setResultPoints] = useState<Point[]>([]);
  const [resultArea, setResultArea] = useState(0);
  const [scaleRef, setScaleRef] = useState<ScaleRef | null>(null);
  const [detectedPolygon, setDetectedPolygon] = useState<Point[] | null>(null);
  const [detectedRuler, setDetectedRuler] = useState<RulerResult | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detectionStatus, setDetectionStatus] = useState('');
  const [detectionError, setDetectionError] = useState<string | null>(null);

  const startDetection = useCallback(async (mode: DrawTool) => {
    if (!imageSrc || detecting) return;

    setDetecting(true);
    setDetectionError(null);
    setDetectionStatus(mode === 'scale' ? 'Détection du mètre...' : 'Détection du contour...');

    // Yield to UI to show spinner
    await new Promise(r => setTimeout(r, 50));

    try {
      if (mode === 'scale') {
        const ruler = await detectRuler(imageSrc);
        if (ruler) {
          setDetectedRuler(ruler);
        } else {
          setDetectionError('Aucun mètre détecté');
        }
      } else {
        const polygon = await detectBlackContour(imageSrc);
        if (polygon && polygon.length >= 3) {
          setDetectedPolygon(polygon);
        } else {
          setDetectionError('Aucun contour détecté');
        }
      }
    } catch (error) {
      console.warn('Detection error:', error);
      setDetectionError(error instanceof Error ? error.message : 'Détection échouée');
    } finally {
      setDetecting(false);
    }
  }, [imageSrc, detecting]);

  const handleCapture = useCallback((dataUrl: string) => {
    setImageSrc(dataUrl);
    setDetectedPolygon(null);
    setDetectedRuler(null);
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
    setPhase('capture');
    setImageSrc('');
    setResultPoints([]);
    setResultArea(0);
    setDetectedPolygon(null);
    setDetectedRuler(null);
    setDetecting(false);
    setScaleRef(null);
  }, []);

  const handleBack = useCallback(() => {
    setPhase('capture');
    setDetectedPolygon(null);
    setDetectedRuler(null);
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
          detectedRuler={detectedRuler}
          detecting={detecting}
          detectionStatus={detectionStatus}
          detectionError={detectionError}
          onClearError={() => setDetectionError(null)}
          onRequestDetection={startDetection}
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
