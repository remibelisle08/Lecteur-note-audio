/** 75 → « 1:15 », 3700 → « 1:01:40 ». */
export function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

export const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/** 1.25 → « 1,25× » */
export const formatRate = (r: number) => `${r.toLocaleString('fr-CA')}×`;

/** Octets → « 12,3 Mo » */
export function formatBytes(bytes: number): string {
  const units = ['o', 'Ko', 'Mo', 'Go'];
  let v = bytes;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${v.toLocaleString('fr-CA', { maximumFractionDigits: i === 0 ? 0 : 1 })} ${units[i]}`;
}

/** Message d'une erreur inattendue → texte français à afficher. */
export const FALLBACK_ERROR = 'Une erreur est survenue. Réessaie.';
