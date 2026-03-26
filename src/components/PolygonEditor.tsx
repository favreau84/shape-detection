import { useState, useEffect, useCallback, useRef } from 'react';
import type { Point, EditorMode, DrawTool, ScaleRef } from '../types';
import { MapViewport } from './MapViewport';
import { InteractionLayer } from './InteractionLayer';
import { useViewport } from '../hooks/useViewport';
import { screenToImage, imageToScreen, distance, computePolygonArea, computePxPerCm, formatAreaCm2, formatAreaPx } from '../utils/geometry';
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

const CLOSE_THRESHOLD_PX = 30;

export function PolygonEditor({ imageSrc, imageSize, detectedPolygon, detectedRuler, detecting, detectionStatus, detectionError, onClearError, onRequestDetection, onDone, onBack }: Props) {
  const [shapePoints, setShapePoints] = useState<Point[]>([]);
  const [closed, setClosed] = useState(false);
  const [mode, setMode] = useState<EditorMode>('draw');
  const [tool, setTool] = useState<DrawTool>('scale');
  const [scalePoints, setScalePoints] = useState<Point[]>([]);
  const [scaleRef, setScaleRef] = useState<ScaleRef | null>(null);
  const [showScaleModal, setShowScaleModal] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const viewport = useViewport();
  const imageLoaded = useRef(false);
  const dragStartPos = useRef<Point | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset view when image loads
  useEffect(() => {
    if (imageSize.width > 0 && !imageLoaded.current) {
      imageLoaded.current = true;
      viewport.resetView(imageSize.width, imageSize.height);
    }
  }, [imageSize, viewport]);

  // Apply detected polygon (shape mode)
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
        // Auto-calibrated: set scale directly, no modal
        setScaleRef({
          p1: detectedRuler.p1,
          p2: detectedRuler.p2,
          valueCm: detectedRuler.distanceCm,
        });
        setTool('shape');
      } else {
        // Fallback: ruler found but no tick marks → ask user
        setShowScaleModal(true);
      }
    }
  }, [detectedRuler]);

  // Show toast on detection error
  useEffect(() => {
    if (detectionError) {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      setToast(detectionError);
      toastTimer.current = setTimeout(() => {
        setToast(null);
        onClearError();
      }, 3000);
    }
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, [detectionError, onClearError]);

  const points = tool === 'shape' ? shapePoints : scalePoints;

  const canClose = useCallback(() => {
    if (tool !== 'shape') return false;
    if (shapePoints.length < 3) return false;
    const firstPt = shapePoints[0];
    const container = viewport.containerRef.current;
    if (!container) return false;
    const rect = container.getBoundingClientRect();
    const centerScreenX = rect.width / 2;
    const centerScreenY = rect.height / 2;
    const firstScreen = imageToScreen(
      firstPt.x, firstPt.y,
      viewport.state.offsetX, viewport.state.offsetY, viewport.state.scale
    );
    return distance(
      { x: centerScreenX, y: centerScreenY },
      { x: firstScreen.x, y: firstScreen.y }
    ) < CLOSE_THRESHOLD_PX;
  }, [shapePoints, viewport, tool]);

  const handleAddPoint = useCallback(() => {
    const container = viewport.containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const imgPt = screenToImage(
      centerX, centerY,
      viewport.state.offsetX, viewport.state.offsetY, viewport.state.scale
    );

    if (tool === 'shape') {
      if (closed) return;
      if (canClose()) {
        setClosed(true);
        return;
      }
      setShapePoints(prev => [...prev, imgPt]);
    } else {
      if (scalePoints.length >= 2) return;
      const newPoints = [...scalePoints, imgPt];
      setScalePoints(newPoints);
      if (newPoints.length === 2) {
        setShowScaleModal(true);
      }
    }
  }, [viewport, closed, canClose, tool, scalePoints]);

  const handleUndo = useCallback(() => {
    if (tool === 'shape') {
      if (closed) {
        setClosed(false);
        return;
      }
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
    if (mode === 'draw') {
      setMode('edit');
      viewport.setLocked(true);
    } else {
      setMode('draw');
      viewport.setLocked(false);
      setDragIndex(null);
    }
  }, [mode, viewport]);

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
      // Credit card diagonal: sqrt(8.56² + 5.398²) ≈ 10.12 cm
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

  // Edit mode: drag handling
  const handleEditPointerDown = useCallback((e: React.PointerEvent) => {
    if (mode !== 'edit') return;
    const container = viewport.containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    let closest = -1;
    let minDist = Infinity;
    for (let i = 0; i < shapePoints.length; i++) {
      const sp = imageToScreen(
        shapePoints[i].x, shapePoints[i].y,
        viewport.state.offsetX, viewport.state.offsetY, viewport.state.scale
      );
      const d = distance({ x: sx, y: sy }, sp);
      if (d < minDist && d < 30) {
        minDist = d;
        closest = i;
      }
    }

    if (closest >= 0) {
      setDragIndex(closest);
      dragStartPos.current = { x: e.clientX, y: e.clientY };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      e.stopPropagation();
    }
  }, [mode, shapePoints, viewport]);

  const handleEditPointerMove = useCallback((e: React.PointerEvent) => {
    if (mode !== 'edit' || dragIndex === null) return;
    const container = viewport.containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const imgPt = screenToImage(
      sx, sy,
      viewport.state.offsetX, viewport.state.offsetY, viewport.state.scale
    );
    setShapePoints(prev => prev.map((p, i) => i === dragIndex ? imgPt : p));
  }, [mode, dragIndex, viewport]);

  const handleEditPointerUp = useCallback(() => {
    setDragIndex(null);
    dragStartPos.current = null;
  }, []);

  // Scale endpoint drag handling
  const [scaleDragIdx, setScaleDragIdx] = useState<number | null>(null);

  const handleScalePointerDown = useCallback((e: React.PointerEvent) => {
    if (tool !== 'scale' || !scaleRef) return;
    const container = viewport.containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    const pts = [scaleRef.p1, scaleRef.p2];
    for (let i = 0; i < 2; i++) {
      const sp = imageToScreen(
        pts[i].x, pts[i].y,
        viewport.state.offsetX, viewport.state.offsetY, viewport.state.scale
      );
      if (distance({ x: sx, y: sy }, sp) < 35) {
        setScaleDragIdx(i);
        viewport.setLocked(true);
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        e.stopPropagation();
        return;
      }
    }
  }, [tool, scaleRef, viewport]);

  const DRAG_OFFSET_PX = 60; // Lift point above finger

  const handleScalePointerMove = useCallback((e: React.PointerEvent) => {
    if (scaleDragIdx === null || !scaleRef) return;
    const container = viewport.containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top - DRAG_OFFSET_PX; // Offset above finger
    const imgPt = screenToImage(
      sx, sy,
      viewport.state.offsetX, viewport.state.offsetY, viewport.state.scale
    );
    const newP1 = scaleDragIdx === 0 ? imgPt : scaleRef.p1;
    const newP2 = scaleDragIdx === 1 ? imgPt : scaleRef.p2;
    setScaleRef({ p1: newP1, p2: newP2, valueCm: scaleRef.valueCm });
    setScalePoints([newP1, newP2]);
  }, [scaleDragIdx, scaleRef, viewport]);

  const handleScalePointerUp = useCallback(() => {
    if (scaleDragIdx !== null) {
      setScaleDragIdx(null);
      viewport.setLocked(false);
    }
  }, [scaleDragIdx, viewport]);

  const getCrosshairImagePos = useCallback((): Point | null => {
    const container = viewport.containerRef.current;
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    return screenToImage(
      rect.width / 2, rect.height / 2,
      viewport.state.offsetX, viewport.state.offsetY, viewport.state.scale
    );
  }, [viewport]);

  const closable = !closed && canClose();
  const area = closed && shapePoints.length >= 3 ? computePolygonArea(shapePoints) : 0;
  const pxPerCm = scaleRef ? computePxPerCm(scaleRef.p1, scaleRef.p2, scaleRef.valueCm) : null;

  const areaDisplay = area > 0
    ? (pxPerCm ? formatAreaCm2(area, pxPerCm) : formatAreaPx(area))
    : '';

  const getAddButtonLabel = () => {
    if (tool === 'scale') {
      if (scalePoints.length >= 2) return 'Échelle définie';
      return scalePoints.length === 0 ? 'Point de début' : 'Point de fin';
    }
    return closable ? 'Terminer' : 'Ajouter un point';
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
          {closed && mode !== 'edit' && (
            <button className="btn btn-ghost" onClick={handleEditToggle}>
              Modifier
            </button>
          )}
          {closed && mode === 'edit' && (
            <button className="btn btn-ghost" onClick={handleEditToggle}>
              OK
            </button>
          )}
        </div>
      </div>

      {/* Viewport */}
      <div
        className="editor-viewport"
        onPointerDown={(e) => {
          if (mode === 'edit') handleEditPointerDown(e);
          else if (tool === 'scale' && scaleRef) handleScalePointerDown(e);
        }}
        onPointerMove={(e) => {
          if (mode === 'edit') handleEditPointerMove(e);
          else if (scaleDragIdx !== null) handleScalePointerMove(e);
        }}
        onPointerUp={() => {
          if (mode === 'edit') handleEditPointerUp();
          else handleScalePointerUp();
        }}
      >
        <MapViewport viewport={viewport}>
          <InteractionLayer
            viewportState={viewport.state}
            imageWidth={imageSize.width}
            imageHeight={imageSize.height}
            imageSrc={imageSrc}
            shapePoints={shapePoints}
            scalePoints={scalePoints}
            scaleRef={scaleRef}
            closed={closed}
            editMode={mode === 'edit'}
            dragIndex={dragIndex}
            activeTool={tool}
            crosshairImagePos={getCrosshairImagePos()}
            scaleDragIdx={scaleDragIdx}
            dragOffsetPx={DRAG_OFFSET_PX}
          />
        </MapViewport>

        {/* Tool toggle overlay - on top of the image */}
        {mode === 'draw' && (
          <div className="viewport-top-bar">
            <div className="tool-toggle">
              <button
                className={`tool-toggle-btn ${tool === 'scale' ? 'active' : ''}`}
                onClick={() => setTool('scale')}
              >
                Échelle
              </button>
              <button
                className={`tool-toggle-btn ${tool === 'shape' ? 'active' : ''}`}
                onClick={() => setTool('shape')}
              >
                Forme
              </button>
            </div>

            {/* Scale badge */}
            {scaleRef && (
              <div className="scale-badge" onClick={handleClearScale}>
                {scaleRef.valueCm.toFixed(1)} cm
                <span className="scale-badge-x">&times;</span>
              </div>
            )}

            {/* Spacer */}
            <div style={{ flex: 1 }} />

            {/* Magic wand button */}
            <button
              className={`btn-magic ${detecting ? 'btn-magic-active' : ''}`}
              onClick={handleMagicWand}
              disabled={detecting}
              title={tool === 'scale' ? 'Détecter une carte' : 'Détecter la forme'}
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

        {/* Detection spinner overlay */}
        {detecting && (
          <div className="detection-overlay">
            <div className="spinner" />
            <span>{detectionStatus}</span>
          </div>
        )}

        {/* Crosshair */}
        {mode === 'draw' && !(tool === 'shape' && closed) && !(tool === 'scale' && scalePoints.length >= 2) && (
          <div className={`crosshair ${closable ? 'crosshair-closable' : ''}`}>
            <svg width="40" height="40" viewBox="0 0 40 40">
              <line x1="20" y1="4" x2="20" y2="16" stroke={closable ? '#4CAF50' : tool === 'scale' ? '#2196F3' : '#F57C00'} strokeWidth="2" strokeLinecap="round" />
              <line x1="20" y1="24" x2="20" y2="36" stroke={closable ? '#4CAF50' : tool === 'scale' ? '#2196F3' : '#F57C00'} strokeWidth="2" strokeLinecap="round" />
              <line x1="4" y1="20" x2="16" y2="20" stroke={closable ? '#4CAF50' : tool === 'scale' ? '#2196F3' : '#F57C00'} strokeWidth="2" strokeLinecap="round" />
              <line x1="24" y1="20" x2="36" y2="20" stroke={closable ? '#4CAF50' : tool === 'scale' ? '#2196F3' : '#F57C00'} strokeWidth="2" strokeLinecap="round" />
              {closable && <circle cx="20" cy="20" r="8" fill="none" stroke="#4CAF50" strokeWidth="2" />}
            </svg>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="editor-footer">
        {closed && tool === 'shape' ? (
          <>
            <div className="area-display">
              <span className="area-label">Surface</span>
              <span className="area-value">{areaDisplay}</span>
              {!scaleRef && <span className="area-hint">Ajoutez une échelle pour obtenir des cm²</span>}
            </div>
            {mode !== 'edit' && (
              <button className="btn btn-primary" onClick={handleDone}>
                Valider
              </button>
            )}
          </>
        ) : tool === 'scale' && scaleRef ? (
          <div className="draw-controls">
            <div className="scale-footer-info">
              <span className="area-label">Échelle</span>
              <span className="area-value area-value-blue">{scaleRef.valueCm.toFixed(1)} cm</span>
              <span className="area-hint">Ajustez les extrémités si besoin</span>
            </div>
            <button className="btn btn-primary" onClick={() => { viewport.setLocked(false); setTool('shape'); }}>
              OK
            </button>
          </div>
        ) : (
          <div className="draw-controls">
            <div className="draw-buttons">
              <button
                className="btn btn-secondary"
                onClick={handleUndo}
                disabled={points.length === 0}
              >
                Retour
              </button>
              <button
                className={`btn ${closable ? 'btn-success' : tool === 'scale' ? 'btn-blue' : 'btn-primary'}`}
                onClick={handleAddPoint}
                disabled={isAddDisabled}
              >
                {getAddButtonLabel()}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Scale modal */}
      {showScaleModal && (
        <ScaleModal
          onConfirm={handleScaleConfirm}
          onCancel={handleScaleCancel}
          onUseCreditCard={handleUseCreditCard}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="toast" onClick={() => { setToast(null); onClearError(); }}>
          {toast}
        </div>
      )}
    </div>
  );
}
