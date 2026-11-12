import { useState } from 'react';

const KEY = 'installHintDismissed';

function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  if (nav.standalone === true) return true;
  return typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
}

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** iOS hors écran d'accueil : invite à installer l'app (masquable, mémorisé). */
export function InstallHint() {
  const [visible, setVisible] = useState(() => isIos() && !isStandalone() && !wasDismissed());
  if (!visible) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* stockage indisponible : masqué pour cette session seulement */
    }
    setVisible(false);
  };
  return (
    <aside className="card hint" aria-label="Installer l'app">
      <p>
        Ajoute l'app à l'écran d'accueil (Partager → Sur l'écran d'accueil) pour l'écoute hors ligne et pour ne pas
        perdre tes notes.
      </p>
      <button type="button" className="icon-btn" aria-label="Masquer ce conseil" onClick={dismiss}>
        ✕
      </button>
    </aside>
  );
}
