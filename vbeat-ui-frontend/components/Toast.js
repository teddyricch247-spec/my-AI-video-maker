'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

// const [say, toast] = useToast();  → render {toast} once, call say('Saved').
export function useToast() {
  const [msg, setMsg] = useState('');
  const timer = useRef();
  const say = useCallback((m) => {
    setMsg(m);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(''), 3200);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return [say, <div key="toast" className={`toast${msg ? ' on' : ''}`} role="status">{msg}</div>];
}
