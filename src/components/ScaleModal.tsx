import { useState, useRef, useEffect } from 'react';

interface Props {
  onConfirm: (valueCm: number) => void;
  onCancel: () => void;
  onUseCreditCard: () => void;
}

export function ScaleModal({ onConfirm, onCancel, onUseCreditCard }: Props) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const num = parseFloat(value.replace(',', '.'));
    if (num > 0) {
      onConfirm(num);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>Distance de référence</h3>
        <p className="modal-desc">Quelle est la distance réelle entre les 2 points ?</p>

        <form onSubmit={handleSubmit}>
          <div className="modal-input-row">
            <input
              ref={inputRef}
              type="number"
              step="0.1"
              min="0.1"
              placeholder="Ex: 8.5"
              value={value}
              onChange={e => setValue(e.target.value)}
              className="modal-input"
              inputMode="decimal"
            />
            <span className="modal-unit">cm</span>
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onCancel}>
              Annuler
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!value || parseFloat(value.replace(',', '.')) <= 0}
            >
              Confirmer
            </button>
          </div>
        </form>

        <div className="modal-divider">
          <span>ou</span>
        </div>

        <button className="btn btn-credit-card" onClick={onUseCreditCard}>
          <svg width="24" height="16" viewBox="0 0 24 16" fill="none">
            <rect x="0.5" y="0.5" width="23" height="15" rx="2" stroke="currentColor" strokeWidth="1"/>
            <line x1="0" y1="5" x2="24" y2="5" stroke="currentColor" strokeWidth="2"/>
            <rect x="3" y="9" width="6" height="2" rx="1" fill="currentColor" opacity="0.5"/>
          </svg>
          Diagonale carte bancaire (10,1 cm)
        </button>
      </div>
    </div>
  );
}
