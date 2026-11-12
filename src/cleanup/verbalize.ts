/** Mots-sigles prononcés comme des mots plutôt qu'épelés (extensible). */
export const PRONOUNCE: Record<string, string> = { GLUT: 'glute' };

const SYMBOLS: Array<[RegExp, string]> = [
  [/\(\s*(\d+)\s*C\s*\)/g, '($1 carbones)'],
  [/\s*→\s*/g, ', donne '],
  [/\s*↑/g, ' augmente'],
  [/\s*↓/g, ' diminue'],
  [/\s*·\s*/g, ', '],
  [/α/g, 'alpha'],
  [/β/g, 'bêta'],
  [/γ/g, 'gamma'],
  [/δ/g, 'delta'],
  [/\s*~\s*/g, ' environ '],
  [/\s*%/g, ' pour cent'],
  [/\s*≥\s*/g, ' supérieur ou égal à '],
  [/\s*≤\s*/g, ' inférieur ou égal à '],
  [/\s*=\s*/g, ' égale '],
  [/(?<![\p{L}\p{N}])ex\./gu, 'par exemple'],
];

const ROMAN: Record<string, string> = { I: '1', II: '2', III: '3' };

const ACRONYM =
  /(?<![\p{L}\p{N}])(\p{Lu}{2,6})(\d*)(?:-(III|II|I)(?![\p{L}\p{N}]))?(?![\p{L}\p{N}])/gu;

export function verbalize(text: string): string {
  let out = text;
  for (const [re, rep] of SYMBOLS) out = out.replace(re, rep);
  out = out.replace(ACRONYM, (_m, letters: string, digits: string, roman?: string) => {
    let s = PRONOUNCE[letters] ?? letters.split('').join(' ');
    if (digits) s += ' ' + digits.split('').join(' ');
    if (roman) s += ' ' + ROMAN[roman];
    return s;
  });
  return out.replace(/ {2,}/g, ' ').replace(/^ +| +$/gm, '');
}
