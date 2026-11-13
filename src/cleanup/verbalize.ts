/** Mots-sigles prononcés comme des mots plutôt qu'épelés (extensible). */
export const PRONOUNCE: Record<string, string> = { GLUT: 'glute' };

// Espaces horizontaux uniquement : les sauts de ligne (paragraphes) sont préservés.
const SYMBOLS: Array<[RegExp, string]> = [
  [/\([ \t]*(\d+)[ \t]*C[ \t]*\)/g, '($1 carbones)'],
  // En début de ligne, pas de virgule orpheline.
  [/(^|\n)[ \t]*→[ \t]*/g, '$1donne '],
  [/[ \t]*→[ \t]*/g, ', donne '],
  [/[ \t]*↑[ \t]*/g, ' augmente '],
  [/[ \t]*↓[ \t]*/g, ' diminue '],
  [/(^|\n)[ \t]*·[ \t]*/g, '$1'],
  [/[ \t]*·[ \t]*/g, ', '],
  [/α/g, 'alpha'],
  [/β/g, 'bêta'],
  [/γ/g, 'gamma'],
  [/δ/g, 'delta'],
  [/[ \t]*~[ \t]*/g, ' environ '],
  [/[ \t]*%/g, ' pour cent'],
  [/[ \t]*≥[ \t]*/g, ' supérieur ou égal à '],
  [/[ \t]*≤[ \t]*/g, ' inférieur ou égal à '],
  [/[ \t]*=[ \t]*/g, ' égale '],
  [/(^|[^\p{L}\p{N}])ex\.[ \t]*/gu, '$1par exemple '],
];

const ROMAN: Record<string, string> = { I: '1', II: '2', III: '3' };

const ACRONYM =
  /(^|[^\p{L}\p{N}])(\p{Lu}{2,6})(\d*)(?:-(III|II|I)(?![\p{L}\p{N}]))?(?![\p{L}\p{N}])/gu;

export function verbalize(text: string): string {
  let out = text;
  for (const [re, rep] of SYMBOLS) out = out.replace(re, rep);
  out = out.replace(
    ACRONYM,
    (_m, pre: string, letters: string, digits: string, roman?: string) => {
      let s = PRONOUNCE[letters] ?? letters.split('').join(' ');
      if (digits) s += ' ' + digits;
      if (roman) s += ' ' + ROMAN[roman];
      return pre + s;
    },
  );
  return out
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^[ \t]+/gm, '')
    .replace(/[ \t]+$/gm, '');
}
