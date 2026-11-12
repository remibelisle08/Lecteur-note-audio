import type { PlayerController, PlayerState } from './controller';

const SEEK_SEC = 15;

/** Branche le lecteur sur la Media Session (écran verrouillé, voiture). Sans effet si l'API est absente. */
export function bindMediaSession(ctrl: PlayerController): void {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession;

  const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
    ['play', () => void ctrl.play()],
    ['pause', () => ctrl.pause()],
    ['seekbackward', (d) => ctrl.seekBy(-(d.seekOffset ?? SEEK_SEC))],
    ['seekforward', (d) => ctrl.seekBy(d.seekOffset ?? SEEK_SEC)],
    ['previoustrack', () => void ctrl.prev().catch(() => undefined)],
    ['nexttrack', () => void ctrl.next().catch(() => undefined)],
    ['seekto', (d) => {
      if (typeof d.seekTime === 'number') ctrl.seekTo(d.seekTime);
    }],
  ];
  for (const [action, handler] of handlers) {
    try {
      ms.setActionHandler(action, handler);
    } catch {
      /* action non prise en charge : ignorée */
    }
  }

  let currentId: string | undefined;
  ctrl.subscribe((s: PlayerState) => {
    const item = s.item;
    if (item?.chapterId !== currentId) {
      currentId = item?.chapterId;
      if (item && typeof MediaMetadata !== 'undefined') {
        ms.metadata = new MediaMetadata({
          title: item.title,
          artist: item.noteTitle,
          album: item.courseName,
          artwork: [{ src: `${import.meta.env.BASE_URL}icons/icon-512.png`, sizes: '512x512', type: 'image/png' }],
        });
      }
    }
    ms.playbackState = s.playing ? 'playing' : 'paused';
    if (s.duration > 0 && s.position <= s.duration) {
      try {
        ms.setPositionState({ duration: s.duration, playbackRate: s.rate, position: s.position });
      } catch {
        /* valeurs refusées par le navigateur : ignorées */
      }
    }
  });
}
