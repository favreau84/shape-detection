export interface Point {
  x: number;
  y: number;
}

export interface ViewportState {
  offsetX: number;
  offsetY: number;
  scale: number;
}

export type AppPhase = 'capture' | 'draw' | 'result';

export type EditorMode = 'draw' | 'edit';
