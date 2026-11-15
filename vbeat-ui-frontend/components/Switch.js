'use client';

export default function Switch({ id, checked, onChange, label, hint }) {
  return (
    <div className="swrow">
      <div>
        <b id={`${id}-l`}>{label}</b>
        {hint && <small id={`${id}-h`}>{hint}</small>}
      </div>
      <button
        type="button"
        role="switch"
        id={id}
        className="sw"
        aria-checked={checked}
        aria-labelledby={`${id}-l`}
        aria-describedby={hint ? `${id}-h` : undefined}
        onClick={() => onChange(!checked)}
      >
        <i />
      </button>
    </div>
  );
}
