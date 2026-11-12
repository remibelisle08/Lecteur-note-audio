/** 0,1 s de silence (WAV PCM 8 bits, 8 kHz, mono). */
export const SILENT_WAV = 'data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YSADAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==';

/**
 * iOS n'autorise la lecture d'un élément audio qu'à partir d'un geste de l'utilisateur.
 * À appeler de façon synchrone dans le gestionnaire du clic, avant toute attente : joue un silence
 * pour « déverrouiller » l'élément, puis l'arrête — sauf si une vraie source l'a remplacé entre-temps.
 * Sans effet (résout false) si l'élément a déjà une vraie source. Résout true si la lecture a été acceptée.
 */
export function unlockElement(el: HTMLAudioElement): Promise<boolean> {
  if (el.src && el.src !== SILENT_WAV) return Promise.resolve(false);
  el.src = SILENT_WAV;
  let played: Promise<void>;
  try {
    played = Promise.resolve(el.play());
  } catch {
    return Promise.resolve(false);
  }
  return played.then(
    () => {
      if (el.src === SILENT_WAV) el.pause();
      return true;
    },
    () => false,
  );
}
