import { describe, it, expect } from 'vitest';
import type { RawBlock } from '../../src/types';
import { detectChapters, estimateMinutes } from '../../src/cleanup/chapters';

const words = (n: number, prefix = 'mot') =>
  Array.from({ length: n }, (_, i) => `${prefix}${i}`).join(' ');
const h = (level: number, text: string): RawBlock => ({ text, kind: 'heading', level });
const p = (text: string): RawBlock => ({ text, kind: 'paragraph' });
const body = (text: string, page?: number): RawBlock => ({
  text,
  kind: 'paragraph',
  fontSize: 12,
  page,
});
const title = (text: string, page?: number): RawBlock => ({
  text,
  kind: 'paragraph',
  fontSize: 20,
  page,
});

describe('detectChapters', () => {
  it('PDF : titre par taille de police', () => {
    const ch = detectChapters(
      [
        body('Les lipides sont des molécules hydrophobes qui servent de réserve énergétique à long terme.', 1),
        title('Absorption des lipides', 2),
        body('Les graisses sont émulsifiées par les sels biliaires avant leur absorption intestinale.', 2),
      ],
      'pdf',
    );
    expect(ch.map(c => c.title)).toEqual(['Introduction', 'Absorption des lipides']);
    expect(ch[1].text).toBe(
      'Les graisses sont émulsifiées par les sels biliaires avant leur absorption intestinale.',
    );
    expect(ch.every(c => c.included)).toBe(true);
  });

  it('PDF : titres consécutifs identiques fusionnés en un chapitre', () => {
    const blocks = [1, 2, 3, 4, 5].flatMap(n => [
      title('Introduction', n),
      body(`Paragraphe numéro ${n} du cours, assez long pour compter comme du texte courant normal.`, n),
    ]);
    const ch = detectChapters(blocks, 'pdf');
    expect(ch).toHaveLength(1);
    expect(ch[0].title).toBe('Introduction');
    expect(ch[0].text).not.toContain('Introduction');
    expect(ch[0].text.split('\n\n')).toHaveLength(5);
  });

  it('DOCX : h1 = chapitres, h2 conservés comme marqueurs « ## » dans text', () => {
    const ch = detectChapters(
      [
        h(1, 'Épisode 1 – Le voyage du gras'),
        h(2, 'Les lipides de notre alimentation'),
        p('Dans notre alimentation…'),
        h(1, 'Épisode 2'),
      ],
      'docx',
    );
    expect(ch.map(c => c.title)).toEqual(['Épisode 1 – Le voyage du gras', 'Épisode 2']);
    expect(ch[0].text).toContain('## Les lipides de notre alimentation');
  });

  it('texte avant le premier titre : chapitre « Introduction »', () => {
    const ch = detectChapters([p('Avant-propos.'), h(1, 'Chapitre A'), p('Texte A.')], 'docx');
    expect(ch.map(c => c.title)).toEqual(['Introduction', 'Chapitre A']);
  });

  it('sans titre : découpe ~1500 mots aux limites de paragraphes', () => {
    const blocks = Array.from({ length: 40 }, (_, i) => p(words(100, `p${i}_`) + '.'));
    const ch = detectChapters(blocks, 'docx');
    expect(ch.map(c => c.title)).toEqual(['Partie 1', 'Partie 2', 'Partie 3']);
    expect(ch.map(c => c.text.split('\n\n').length)).toEqual([15, 15, 10]);
    for (const c of ch) for (const para of c.text.split('\n\n')) expect(para.split(' ')).toHaveLength(100);
  });

  it('un paragraphe de plus de 1500 mots reste entier', () => {
    const ch = detectChapters([p(words(1600) + '.'), p('Court.')], 'docx');
    expect(ch).toHaveLength(2);
    expect(ch[0].text.split(' ')).toHaveLength(1600);
  });

  it('marque les légendes courtes isolées', () => {
    const ch = detectChapters(
      [
        h(1, 'Chapitre'),
        p('Une phrase complète et assez longue pour le test, qui se termine bien.'),
        p('Schéma de la digestion'),
        p('Une autre phrase complète et assez longue pour le test, aussi terminée.'),
      ],
      'docx',
    );
    expect(ch[0].flags).toContain('has-captions');
    expect(ch[0].text).toContain('Schéma de la digestion');
  });

  it('pas de légende sans paragraphe de chaque côté', () => {
    const ch = detectChapters([h(1, 'Chapitre'), p('Texte complet qui finit bien.'), p('Fin courte')], 'docx');
    expect(ch[0].flags).toEqual([]);
  });
});

describe('estimateMinutes', () => {
  it('1500 mots → 10', () => expect(estimateMinutes(words(1500))).toBe(10));
  it('minimum 1 pour du texte, 0 pour vide', () => {
    expect(estimateMinutes('bonjour')).toBe(1);
    expect(estimateMinutes('')).toBe(0);
    expect(estimateMinutes('   ')).toBe(0);
  });
});
