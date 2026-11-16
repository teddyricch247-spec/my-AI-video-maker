'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginForm() {
  const router = useRouter();
  const input = useRef(null);
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // Prototype: any password works, except the word "wrong", so you can see the error state.
  const submit = (e) => {
    e.preventDefault();
    if (!pw || busy) return;
    setBusy(true);
    setErr('');
    setTimeout(() => {
      if (pw.trim().toLowerCase() === 'wrong') {
        setErr('Wrong password. Try again.');
        setBusy(false);
        input.current?.select();
      } else {
        router.push('/');
      }
    }, 700);
  };

  return (
    <form className="card authcard stack" onSubmit={submit} noValidate>
      <div className="authbrand">
        <i aria-hidden="true">▶</i>
        <h1>vbeat</h1>
      </div>
      <p className="muted">Turn a transcript into short animated beats.</p>

      <div className="fld">
        <label htmlFor="pw">Password</label>
        <div className="pwrow">
          <input
            ref={input}
            id="pw"
            name="password"
            className={`inp${err ? ' bad' : ''}`}
            type={show ? 'text' : 'password'}
            autoComplete="current-password"
            autoFocus
            required
            value={pw}
            onChange={(e) => { setPw(e.target.value); if (err) setErr(''); }}
            aria-invalid={err ? 'true' : undefined}
            aria-describedby={err ? 'login-err' : undefined}
          />
          <button type="button" className="pwtoggle" onClick={() => setShow((s) => !s)} aria-pressed={show}>
            {show ? 'Hide' : 'Show'}
          </button>
        </div>
        <p id="login-err" className="errtext" role="alert">{err}</p>
      </div>

      <button type="submit" className="btn pri wide" disabled={!pw || busy}>{busy ? 'Logging in…' : 'Log in'}</button>
      <p className="hint center">Prototype: type “wrong” to see the error.</p>
    </form>
  );
}
