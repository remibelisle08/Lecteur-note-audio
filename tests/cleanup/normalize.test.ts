import { describe, it, expect } from 'vitest';
import type { RawBlock } from '../../src/types';
import {
  joinLines,
  removePageNumbers,
  stripOcrArtifacts,
  normalizeWhitespace,
  dropNoiseBlocks,
} from '../../src/cleanup/normalize';

const p = (text: string, page?: number): RawBlock => ({ text, kind: 'paragraph', page });
const h = (text: string, page?: number): RawBlock => ({ text, kind: 'heading', level: 1, page });

describe('joinLines', () => {
  it('recolle une césure de fin de ligne', () => {
    const out = joinLines([p('les mouvements de con-', 1), p('traction cisaillent', 1)]);
    expect(out.map(b => b.text)).toEqual(['les mouvements de contraction cisaillent']);
  });
  it('fusionne les lignes d’un même paragraphe, pas après une ponctuation finale', () => {
    const out = joinLines([
      p('Les micelles contenant les produits', 1),
      p('de dégradation entrent.', 1),
      p('Une fois dans la cellule', 1),
    ]);
    expect(out.map(b => b.text)).toEqual([
      'Les micelles contenant les produits de dégradation entrent.',
      'Une fois dans la cellule',
    ]);
  });
  it('ne fusionne jamais un titre', () => {
    const out = joinLines([p('Introduction au sujet', 1), h('Les lipides', 1), p('Ils sont variés', 1)]);
    expect(out.map(b => [b.kind, b.text])).toEqual([
      ['paragraph', 'Introduction au sujet'],
      ['heading', 'Les lipides'],
      ['paragraph', 'Ils sont variés'],
    ]);
  });
  it('ne fusionne jamais des blocs sans page (DOCX)', () => {
    const out = joinLines([p('Premier paragraphe sans point'), p('Second paragraphe')]);
    expect(out.map(b => b.text)).toEqual(['Premier paragraphe sans point', 'Second paragraphe']);
  });
  it('ne fusionne pas une ligne courte sans ponctuation avec une ligne en majuscule', () => {
    const out = joinLines([p('Schéma de la digestion', 1), p('Une phrase suivante.', 1)]);
    expect(out.map(b => b.text)).toEqual(['Schéma de la digestion', 'Une phrase suivante.']);
  });
  it('ne fusionne pas à travers les pages', () => {
    const out = joinLines([p('Fin de page sans point', 1), p('début de page suivante', 2)]);
    expect(out.map(b => b.text)).toEqual(['Fin de page sans point', 'début de page suivante']);
  });
});

describe('removePageNumbers', () => {
  it('retire les numéros de page isolés', () => {
    const out = removePageNumbers([
      p('12'),
      p('- 12 -'),
      p('Page 3 de 40'),
      p('Chapitre 4 (partie 2) – Lipides · 2/13'),
      p('90 à 95 %'),
    ]);
    expect(out.map(b => b.text)).toEqual(['Chapitre 4 (partie 2) – Lipides · 2/13', '90 à 95 %']);
  });
});

describe('stripOcrArtifacts', () => {
  it('retire les pastilles OCR en début de paragraphe', () => {
    expect(stripOcrArtifacts('ŒZ) Le défi. L’intestin')).toBe('Le défi. L’intestin');
    expect(stripOcrArtifacts('Œ2 Sources de lipides.')).toBe('Sources de lipides.');
    expect(stripOcrArtifacts('© Après la livraison.')).toBe('Après la livraison.');
    expect(stripOcrArtifacts('@D La LPL.')).toBe('La LPL.');
  });
  it('laisse intact un texte normal', () => {
    expect(stripOcrArtifacts('Les lipides sont utiles.')).toBe('Les lipides sont utiles.');
  });
});

describe('normalizeWhitespace', () => {
  it('réduit les espaces, convertit les insécables, garde les sauts de paragraphe', () => {
    expect(normalizeWhitespace('  a \t  b c  \n\n  d   e ')).toBe('a b c\n\nd e');
  });
});

describe('dropNoiseBlocks', () => {
  it('retire les blocs de moins de 3 lettres', () => {
    const out = dropNoiseBlocks([p('··'), p('12)'), p('Il'), p('ATP')]);
    expect(out.map(b => b.text)).toEqual(['ATP']);
  });
});
