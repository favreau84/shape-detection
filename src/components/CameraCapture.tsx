import { useRef } from 'react';

interface Props {
  onCapture: (imageDataUrl: string) => void;
}

export function CameraCapture({ onCapture }: Props) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onCapture(reader.result);
      }
    };
    reader.readAsDataURL(file);
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
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <rect x="2" y="5" width="16" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
              <circle cx="10" cy="11" r="3.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
            </svg>
            Prendre une photo
          </button>
          <button className="btn btn-secondary" onClick={() => galleryRef.current?.click()}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <rect x="2" y="2" width="16" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
              <circle cx="7" cy="7" r="2" fill="currentColor" opacity="0.6" />
              <path d="M2 14L6 10L10 14L14 8L18 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Choisir une image
          </button>
        </div>
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleChange}
          style={{ display: 'none' }}
        />
        <input
          ref={galleryRef}
          type="file"
          accept="image/*"
          onChange={handleChange}
          style={{ display: 'none' }}
        />
      </div>
    </div>
  );
}
