import type { ReactNode } from 'react';
import type { ViewportHandler } from '../hooks/useViewport';

interface Props {
  viewport: ViewportHandler;
  children: ReactNode;
}

export function MapViewport({ viewport, children }: Props) {
  return (
    <div
      ref={viewport.containerRef}
      className="map-viewport"
      onPointerDown={viewport.onPointerDown}
      onPointerMove={viewport.onPointerMove}
      onPointerUp={viewport.onPointerUp}
      onPointerCancel={viewport.onPointerUp}
      onWheel={viewport.onWheel}
      style={{ touchAction: 'none' }}
    >
      {children}
    </div>
  );
}
