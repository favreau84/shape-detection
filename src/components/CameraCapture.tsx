import { useRef } from 'react';

const MAX_DIM = 2000;

interface Props {
  onCapture: (imageDataUrl: string, width: number, height: number) => void;
}

export function CameraCapture({ onCapture }: Props) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      // Downscale to MAX_DIM for performance
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      if (w > MAX_DIM || h > MAX_DIM) {
        const ratio = Math.min(MAX_DIM / w, MAX_DIM / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      onCapture(dataUrl, w, h);
    };
    img.src = url;
  };

  return (
    <div className="capture-screen">
      <div className="capture-content">
        <div className="capture-icon">
          <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
            <rect x="8" y="20" width="64" height="48" rx="8" stroke="currentColor" strokeWidth="3" fill="none" />
            <circle cx="40" cy="44" r="14" stroke="currentColor" strokeWidth="3" fill="none" />
            <circle cx="40" cy="44" r="6" fill="currentColor" />
            <rect x="28" y="14" width="24" height="10" rx="4" stroke="currentColor" strokeWidth="3" fill="none" />
          </svg>
        </div>
        <h1>Mesure de Cloque</h1>
        <p className="capture-subtitle">Prenez une photo pour mesurer la surface</p>
        <div className="capture-buttons">
          <button className="btn btn-primary" onClick={() => cameraRef.current?.click()}>
            Prendre une photo
          </button>
          <button className="btn btn-secondary" onClick={() => galleryRef.current?.click()}>
            Choisir une image
          </button>
        </div>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={handleChange} style={{ display: 'none' }} />
        <input ref={galleryRef} type="file" accept="image/*" onChange={handleChange} style={{ display: 'none' }} />
      </div>
    </div>
  );
}
