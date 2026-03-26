import { useState, useEffect, useCallback, useRef } from 'react';
import type { Point, EditorMode, DrawTool, ScaleRef } from '../types';
import { KonvaEditor } from './KonvaEditor';
import { distance, computePolygonArea, computePxPerCm, formatAreaCm2, formatAreaPx } from '../utils/geometry';
import { ScaleModal } from './ScaleModal';

interface RulerResult {
  p1: Point;
  p2: Point;
  distanceCm: number;
}

interface Props {
  imageSrc: string;
  imageSize: { width: number; height: number };
  detectedPolygon: Point[] | null;
  detectedRuler: RulerResult | null;
  detecting: boolean;
  detectionStatus: string;
  detectionError: string | null;
  onClearError: () => void;
  onRequestDetection: (mode: DrawTool) => void;
  onDone: (points: Point[], area: number, scale: ScaleRef | null) => void;
  onBack: () => void;
}

const DRAG_OFFSET_PX = 60;

export function PolygonEditor({ imageSrc, imageSize, detectedPolygon, detectedRuler, detecting, detectionStatus, detectionError, onClearError, onRequestDetection, onDone, onBack }: Props) {
  const [shapePoints, setShapePoints] = useState<Point[]>([]);
  const [closed, setClosed] = useState(false);
  const [mode, setMode] = useState<EditorMode>('draw');
  const [tool, setTool] = useState<DrawTool>('scale');
  const [scalePoints, setScalePoints] = useState<Point[]>([]);
  const [scaleRef, setScaleRef] = useState<ScaleRef | null>(null);
  const [showScaleModal, setShowScaleModal] = useState(false);
  const [scaleDragIdx, setScaleDragIdx] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const crosshairPosRef = useRef<Point | null>(null);

  // Apply detected polygon
  useEffect(() => {
    if (detectedPolygon && detectedPolygon.length >= 3) {
      setShapePoints(detectedPolygon);
      setClosed(true);
      setTool('shape');
    }
  }, [detectedPolygon]);

  // Apply detected ruler
  useEffect(() => {
    if (detectedRuler) {
      setScalePoints([detectedRuler.p1, detectedRuler.p2]);
      if (detectedRuler.distanceCm > 0) {
        setScaleRef({
          p1: detectedRuler.p1,
          p2: detectedRuler.p2,
          valueCm: detectedRuler.distanceCm,
        });
        setTool('shape');
      } else {
        setShowScaleModal(true);
      }
    }
  }, [detectedRuler]);

  // Toast on error
  useEffect(() => {
    if (detectionError) {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      setToast(detectionError);
      toastTimer.current = setTimeout(() => {
        setToast(null);
        onClearError();
      }, 3000);
    }
    return () => { if (toastTimer.current) clearTimeout(toastTimer.current); };
  }, [detectionError, onClearError]);

  const points = tool === 'shape' ? shapePoints : scalePoints;

  const handleAddPoint = useCallback(() => {
    const pos = crosshairPosRef.current;
    if (!pos) return;

    if (tool === 'shape') {
      if (closed) return;
      // Check if we can close (crosshair near first point)
      if (shapePoints.length >= 3) {
        const first = shapePoints[0];
        const d = distance(pos, first);
        // Use a threshold in image space (relative to image size)
        const threshold = Math.max(imageSize.width, imageSize.height) * 0.02;
        if (d < threshold) {
          setClosed(true);
          return;
        }
      }
      setShapePoints(prev => [...prev, pos]);
    } else {
      if (scalePoints.length >= 2) return;
      const newPoints = [...scalePoints, pos];
      setScalePoints(newPoints);
      if (newPoints.length === 2) {
        setShowScaleModal(true);
      }
    }
  }, [tool, closed, shapePoints, scalePoints, imageSize]);

  const handleUndo = useCallback(() => {
    if (tool === 'shape') {
      if (closed) { setClosed(false); return; }
      setShapePoints(prev => prev.slice(0, -1));
    } else {
      setScalePoints(prev => prev.slice(0, -1));
    }
  }, [closed, tool]);

  const handleDone = useCallback(() => {
    if (!closed || shapePoints.length < 3) return;
    const area = computePolygonArea(shapePoints);
    onDone(shapePoints, area, scaleRef);
  }, [closed, shapePoints, scaleRef, onDone]);

  const handleEditToggle = useCallback(() => {
    setMode(prev => prev === 'draw' ? 'edit' : 'draw');
  }, []);

  const handleScaleConfirm = useCallback((valueCm: number) => {
    if (scalePoints.length === 2) {
      setScaleRef({ p1: scalePoints[0], p2: scalePoints[1], valueCm });
    }
    setShowScaleModal(false);
    setTool('shape');
  }, [scalePoints]);

  const handleScaleCancel = useCallback(() => {
    setShowScaleModal(false);
    setScalePoints([]);
  }, []);

  const handleUseCreditCard = useCallback(() => {
    if (scalePoints.length === 2) {
      setScaleRef({ p1: scalePoints[0], p2: scalePoints[1], valueCm: 10.12 });
    }
    setShowScaleModal(false);
    setTool('shape');
  }, [scalePoints]);

  const handleClearScale = useCallback(() => {
    setScaleRef(null);
    setScalePoints([]);
  }, []);

  const handleMagicWand = useCallback(() => {
    onRequestDetection(tool);
  }, [onRequestDetection, tool]);

  // Konva callbacks
  const handleShapePointDrag = useCallback((index: number, pt: Point) => {
    setShapePoints(prev => prev.map((p, i) => i === index ? pt : p));
  }, []);

  const handleScalePointDrag = useCallback((index: number, pt: Point) => {
    if (!scaleRef) return;
    const newP1 = index === 0 ? pt : scaleRef.p1;
    const newP2 = index === 1 ? pt : scaleRef.p2;
    setScaleRef({ p1: newP1, p2: newP2, valueCm: scaleRef.valueCm });
    setScalePoints([newP1, newP2]);
  }, [scaleRef]);

  const area = closed && shapePoints.length >= 3 ? computePolygonArea(shapePoints) : 0;
  const pxPerCm = scaleRef ? computePxPerCm(scaleRef.p1, scaleRef.p2, scaleRef.valueCm) : null;
  const areaCm2 = (area > 0 && pxPerCm) ? area / (pxPerCm * pxPerCm) : null;
  const areaDisplay = area > 0 ? (pxPerCm ? formatAreaCm2(area, pxPerCm) : formatAreaPx(area)) : '';

  const getAddButtonLabel = () => {
    if (tool === 'scale') {
      if (scalePoints.length >= 2) return 'Échelle définie';
      return scalePoints.length === 0 ? 'Point de début' : 'Point de fin';
    }
    return 'Ajouter un point';
  };

  const isAddDisabled = tool === 'scale' && scalePoints.length >= 2;

  return (
    <div className="editor-screen">
      {/* Header */}
      <div className="editor-header">
        <button className="btn btn-ghost" onClick={onBack}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M12 4L6 10L12 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <span className="editor-title">
          {detecting ? detectionStatus : closed ? 'Polygone fermé' : tool === 'scale' ? 'Échelle' : `${shapePoints.length} point${shapePoints.length !== 1 ? 's' : ''}`}
        </span>
        <div className="editor-header-actions">
          {closed && (
            <button className="btn btn-ghost" onClick={handleEditToggle}>
              {mode === 'edit' ? 'OK' : 'Modifier'}
            </button>
          )}
        </div>
      </div>

      {/* Viewport wrapper */}
      <div className="editor-viewport-wrapper">
      <KonvaEditor
        imageSrc={imageSrc}
        imageWidth={imageSize.width}
        imageHeight={imageSize.height}
        shapePoints={shapePoints}
        scaleRef={scaleRef}
        scalePoints={scalePoints}
        closed={closed}
        editMode={mode === 'edit'}
        activeTool={tool}
        locked={mode === 'edit' || (tool === 'scale' && scaleDragIdx !== null)}
        scaleDragIdx={scaleDragIdx}
        dragOffsetPx={DRAG_OFFSET_PX}
        onShapePointDrag={handleShapePointDrag}
        onScalePointDrag={handleScalePointDrag}
        onScaleDragStart={(i) => setScaleDragIdx(i)}
        onScaleDragEnd={() => setScaleDragIdx(null)}
        onCrosshairPosChange={(pos) => { crosshairPosRef.current = pos; }}
        areaCm2={areaCm2}
      />

      {/* Overlays on top of viewport */}
      <div className="editor-overlays">
        {/* Tool toggle */}
        {mode === 'draw' && (
          <div className="viewport-top-bar">
            <div className="tool-toggle">
              <button className={`tool-toggle-btn ${tool === 'scale' ? 'active' : ''}`} onClick={() => setTool('scale')}>Échelle</button>
              <button className={`tool-toggle-btn ${tool === 'shape' ? 'active' : ''}`} onClick={() => setTool('shape')}>Forme</button>
            </div>
            {scaleRef && (
              <div className="scale-badge" onClick={handleClearScale}>
                {scaleRef.valueCm.toFixed(1)} cm
                <span className="scale-badge-x">&times;</span>
              </div>
            )}
            <div style={{ flex: 1 }} />
            <button
              className={`btn-magic ${detecting ? 'btn-magic-active' : ''}`}
              onClick={handleMagicWand}
              disabled={detecting}
              title={tool === 'scale' ? 'Détecter le mètre' : 'Détecter le contour'}
            >
              {detecting ? (
                <div className="spinner spinner-sm" />
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <path d="M3 21L12.5 11.5M12.5 11.5L15 4L17.5 11.5L24 14L17.5 16.5L15 24L12.5 16.5L6 14L12.5 11.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round"/>
                  <path d="M6 2L7 5L10 6L7 7L6 10L5 7L2 6L5 5L6 2Z" fill="currentColor" opacity="0.6"/>
                </svg>
              )}
            </button>
          </div>
        )}
        {detecting && (
          <div className="detection-overlay">
            <div className="spinner" />
            <span>{detectionStatus}</span>
          </div>
        )}
      </div>
      </div>

      {/* Footer */}
      <div className="editor-footer">
        {closed && tool === 'shape' ? (
          <>
            <div className="area-display">
              <span className="area-label">Surface</span>
              <span className="area-value">{areaDisplay}</span>
              {!scaleRef && <span className="area-hint">Ajoutez une échelle pour cm²</span>}
            </div>
            {mode !== 'edit' && (
              <button className="btn btn-primary" onClick={handleDone}>Valider</button>
            )}
          </>
        ) : tool === 'scale' && scaleRef ? (
          <div className="draw-controls">
            <div className="scale-footer-info">
              <span className="area-label">Échelle</span>
              <span className="area-value area-value-blue">{scaleRef.valueCm.toFixed(1)} cm</span>
              <span className="area-hint">Ajustez les extrémités si besoin</span>
            </div>
            <button className="btn btn-primary" onClick={() => setTool('shape')}>OK</button>
          </div>
        ) : (
          <div className="draw-controls">
            <div className="draw-buttons">
              <button className="btn btn-secondary" onClick={handleUndo} disabled={points.length === 0}>Retour</button>
              <button
                className={`btn ${tool === 'scale' ? 'btn-blue' : 'btn-primary'}`}
                onClick={handleAddPoint}
                disabled={isAddDisabled}
              >{getAddButtonLabel()}</button>
            </div>
          </div>
        )}
      </div>

      {showScaleModal && (
        <ScaleModal onConfirm={handleScaleConfirm} onCancel={handleScaleCancel} onUseCreditCard={handleUseCreditCard} />
      )}

      {toast && (
        <div className="toast" onClick={() => { setToast(null); onClearError(); }}>{toast}</div>
      )}
    </div>
  );
}
