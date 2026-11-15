'use client';

// Prototype helper: lets you flip a page between its states without a backend.
// Delete the <StatePreview /> lines (and this file) when the pages get wired.
export default function StatePreview({ label = 'Preview state', options, value, onChange }) {
  return (
    <div className="preview" role="group" aria-label={label}>
      <span>{label}</span>
      {options.map(([k, l]) => (
        <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)}>{l}</button>
      ))}
    </div>
  );
}
