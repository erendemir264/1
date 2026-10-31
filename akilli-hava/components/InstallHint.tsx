'use client';

import { useEffect, useState } from 'react';

const KEY = 'akilli-hava:install-hint';

type Mode = 'ios' | 'android' | null;

export default function InstallHint() {
  const [mode, setMode] = useState<Mode>(null);
  const [prompt, setPrompt] = useState<any>(null);

  useEffect(() => {
    // Register the service worker (offline + "installable" requirement)
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
    if (standalone) return;
    try {
      if (localStorage.getItem(KEY)) return;
    } catch {}
    const ua = navigator.userAgent;
    const isIOS = /iPhone|iPad|iPod/.test(ua) && !/CriOS|FxiOS/.test(ua);
    if (isIOS) setMode('ios');
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e);
      setMode('android');
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  if (!mode) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(KEY, '1');
    } catch {}
    setMode(null);
  };

  return (
    <div className="install">
      <div className="i">📲</div>
      <div style={{ flex: 1 }}>
        <b>Uygulama olarak ekle</b>
        {mode === 'ios' ? (
          <span>
            Safari'de <b>Paylaş</b> (⎋) → <b>Ana Ekrana Ekle</b>. Simgesiyle tam ekran açılır.
          </span>
        ) : (
          <span>Ana ekrana simge olarak eklenir, tam ekran açılır.</span>
        )}
      </div>
      {mode === 'android' && (
        <button
          className="primary"
          onClick={async () => {
            prompt?.prompt?.();
            const r = await prompt?.userChoice;
            if (r?.outcome === 'accepted') dismiss();
          }}
        >
          Ekle
        </button>
      )}
      <button className="iconbtn" onClick={dismiss} aria-label="Kapat">
        ✕
      </button>
    </div>
  );
}
