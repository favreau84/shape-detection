import { useState, useEffect, useCallback, useRef } from 'react';
import type { Point, EditorMode } from '../types';
import { MapViewport } from './MapViewport';
import { InteractionLayer } from './InteractionLayer';
import { useViewport } from '../hooks/useViewport';
import { screenToImage, imageToScreen, distance, computePolygonArea, formatArea } from '../utils/geometry';

interface Props {
  imageSrc: string;
  detectedPolygon: Point[] | null;
  detecting: boolean;
  detectionStatus: string;
  onDone: (points: Point[], area: number) => void;
  onBack: () => void;
}

const CLOSE_THRESHOLD_PX = 30;

export function PolygonEditor({ imageSrc, detectedPolygon, detecting, detectionStatus, onDone, onBack }: Props) {
  const [points, setPoints] = useState<Point[]>([]);
  const [closed, setClosed] = useState(false);
  const [mode, setMode] = useState<EditorMode>('draw');
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const viewport = useViewport();
  const imageLoaded = useRef(false);
  const dragStartPos = useRef<Point | null>(null);

  // Load image dimensions
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      setImageSize({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.src = imageSrc;
  }, [imageSrc]);

  // Reset view when image loads
  useEffect(() => {
    if (imageSize.width > 0 && !imageLoaded.current) {
      imageLoaded.current = true;
      viewport.resetView(imageSize.width, imageSize.height);
    }
  }, [imageSize, viewport]);

  // Apply detected polygon
  useEffect(() => {
    if (detectedPolygon && detectedPolygon.length >= 3 && points.length === 0) {
      setPoints(detectedPolygon);
      setClosed(true);
    }
  }, [detectedPolygon, points.length]);

  const canClose = useCallback(() => {
    if (points.length < 3) return false;
    const firstPt = points[0];
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
  }, [points, viewport]);

  const handleAddPoint = useCallback(() => {
    if (closed) return;
    const container = viewport.containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    if (canClose()) {
      setClosed(true);
      return;
    }

    const imgPt = screenToImage(
      centerX, centerY,
      viewport.state.offsetX, viewport.state.offsetY, viewport.state.scale
    );
    setPoints(prev => [...prev, imgPt]);
  }, [viewport, closed, canClose]);

  const handleUndo = useCallback(() => {
    if (closed) {
      setClosed(false);
      return;
    }
    setPoints(prev => prev.slice(0, -1));
  }, [closed]);

  const handleDone = useCallback(() => {
    if (!closed || points.length < 3) return;
    const area = computePolygonArea(points);
    onDone(points, area);
  }, [closed, points, onDone]);

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

  // Edit mode: drag handling
  const handleEditPointerDown = useCallback((e: React.PointerEvent) => {
    if (mode !== 'edit') return;
    const container = viewport.containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    // Find closest point
    let closest = -1;
    let minDist = Infinity;
    for (let i = 0; i < points.length; i++) {
      const sp = imageToScreen(
        points[i].x, points[i].y,
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
  }, [mode, points, viewport]);

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
    setPoints(prev => prev.map((p, i) => i === dragIndex ? imgPt : p));
  }, [mode, dragIndex, viewport]);

  const handleEditPointerUp = useCallback(() => {
    setDragIndex(null);
    dragStartPos.current = null;
  }, []);

  const closable = !closed && canClose();
  const area = closed && points.length >= 3 ? computePolygonArea(points) : 0;

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
          {detecting ? detectionStatus : closed ? 'Polygone fermé' : `${points.length} point${points.length !== 1 ? 's' : ''}`}
        </span>
        {closed && (
          <button className="btn btn-ghost" onClick={handleEditToggle}>
            {mode === 'edit' ? 'OK' : 'Modifier'}
          </button>
        )}
      </div>

      {/* Detection spinner overlay */}
      {detecting && (
        <div className="detection-overlay">
          <div className="spinner" />
          <span>{detectionStatus}</span>
        </div>
      )}

      {/* Viewport */}
      <div
        className="editor-viewport"
        onPointerDown={mode === 'edit' ? handleEditPointerDown : undefined}
        onPointerMove={mode === 'edit' ? handleEditPointerMove : undefined}
        onPointerUp={mode === 'edit' ? handleEditPointerUp : undefined}
      >
        <MapViewport viewport={viewport}>
          <InteractionLayer
            viewportState={viewport.state}
            imageWidth={imageSize.width}
            imageHeight={imageSize.height}
            imageSrc={imageSrc}
            points={points}
            closed={closed}
            editMode={mode === 'edit'}
            dragIndex={dragIndex}
          />
        </MapViewport>

        {/* Crosshair (fixed center) - only in draw mode when not closed */}
        {!closed && mode === 'draw' && (
          <div className={`crosshair ${closable ? 'crosshair-closable' : ''}`}>
            <svg width="40" height="40" viewBox="0 0 40 40">
              <line x1="20" y1="4" x2="20" y2="16" stroke={closable ? '#4CAF50' : '#F57C00'} strokeWidth="2" strokeLinecap="round" />
              <line x1="20" y1="24" x2="20" y2="36" stroke={closable ? '#4CAF50' : '#F57C00'} strokeWidth="2" strokeLinecap="round" />
              <line x1="4" y1="20" x2="16" y2="20" stroke={closable ? '#4CAF50' : '#F57C00'} strokeWidth="2" strokeLinecap="round" />
              <line x1="24" y1="20" x2="36" y2="20" stroke={closable ? '#4CAF50' : '#F57C00'} strokeWidth="2" strokeLinecap="round" />
              {closable && <circle cx="20" cy="20" r="8" fill="none" stroke="#4CAF50" strokeWidth="2" />}
            </svg>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="editor-footer">
        {closed ? (
          <>
            <div className="area-display">
              <span className="area-label">Surface</span>
              <span className="area-value">{formatArea(area, imageSize.width * imageSize.height)}</span>
            </div>
            {mode !== 'edit' && (
              <button className="btn btn-primary" onClick={handleDone}>
                Valider
              </button>
            )}
          </>
        ) : (
          <div className="draw-controls">
            <button
              className="btn btn-secondary"
              onClick={handleUndo}
              disabled={points.length === 0}
            >
              Retour
            </button>
            <button
              className={`btn ${closable ? 'btn-success' : 'btn-primary'}`}
              onClick={handleAddPoint}
            >
              {closable ? 'Terminer' : 'Ajouter un point'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
