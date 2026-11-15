'use client';
import { useEffect, useRef } from 'react';

// Native <dialog>: focus is trapped, Esc closes, the page behind is inert.
export default function Confirm({ open, title, message, ok = 'Confirm', danger, onOk, onCancel }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="dlg"
      aria-labelledby="dlg-title"
      onCancel={(e) => { e.preventDefault(); onCancel(); }}
      onClick={(e) => { if (e.target === ref.current) onCancel(); }}
    >
      <h2 id="dlg-title">{title}</h2>
      <p>{message}</p>
      <div className="acts">
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button type="button" className={`btn pri${danger ? ' dng' : ''}`} onClick={onOk}>{ok}</button>
      </div>
    </dialog>
  );
}
