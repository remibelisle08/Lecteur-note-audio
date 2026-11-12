import { describe, it, expect } from 'vitest';
import type { RawBlock } from '../../src/types';
import { removeHeadersFooters, dedupeProgressiveSlides } from '../../src/cleanup/pages';

const b = (text: string, page?: number, yRatio?: number): RawBlock => ({
  text,
  kind: 'paragraph',
  page,
  yRatio,
});
const pagesOf = (blocks: RawBlock[]) => [...new Set(blocks.map(x => x.page))];

describe('removeHeadersFooters', () => {
  const foot = (n: number) => b(`Chapitre 4 (partie 2) – Lipides · ${n}/13`, n, 0.97);

  it('retire un pied de page répété avec numéro variable', () => {
    const blocks = [1, 2, 3, 4].flatMap(n => [b(`Contenu ${n}`, n, 0.4), foot(n)]);
    const out = removeHeadersFooters(blocks);
    expect(out.some(x => x.text.includes('Lipides ·'))).toBe(false);
    expect(out.map(x => x.text)).toEqual(['Contenu 1', 'Contenu 2', 'Contenu 3', 'Contenu 4']);
  });
  it('retire un en-tête répété en haut de page', () => {
    const blocks = [1, 2, 3].flatMap(n => [b('Biochimie L2', n, 0.03), b(`Texte ${n}`, n, 0.5)]);
    const out = removeHeadersFooters(blocks);
    expect(out.some(x => x.text === 'Biochimie L2')).toBe(false);
    expect(out).toHaveLength(3);
  });
  it('garde une ligne répétée au milieu de la page', () => {
    const blocks = [1, 2, 3, 4].map(n => b('Rappel important', n, 0.5));
    expect(removeHeadersFooters(blocks)).toHaveLength(4);
  });
  it('garde une ligne en bas de page présente sur < 50 % des pages', () => {
    const blocks = [1, 2, 3, 4].map(n => b(`Texte ${n}`, n, 0.4));
    blocks.push(b('Source : manuel', 2, 0.95));
    const out = removeHeadersFooters(blocks);
    expect(out.some(x => x.text === 'Source : manuel')).toBe(true);
    expect(out).toHaveLength(5);
  });
  it('ne retire rien avec moins de 3 pages', () => {
    const blocks = [1, 2].flatMap(n => [b(`Texte ${n}`, n, 0.4), foot(n)]);
    expect(removeHeadersFooters(blocks)).toHaveLength(4);
  });
  it('laisse passer les blocs sans page', () => {
    const blocks = [b('A'), b('B', undefined, 0.97), b('C')];
    expect(removeHeadersFooters(blocks)).toEqual(blocks);
  });
});

describe('dedupeProgressiveSlides', () => {
  const t = 'Défi physico-chimique';
  const l1 = 'Les lipides sont insolubles dans l’eau.';
  const l2 = 'Ils forment des gouttelettes volumineuses.';
  const l3 = 'Pour éviter ce problème, l’organisme utilise l’émulsion';

  it('supprime une diapo dont le texte est contenu dans la suivante', () => {
    const blocks = [
      b(t, 2), b(l1, 2), b(l2, 2),
      b(t, 3), b(l1, 3), b(l2, 3), b(l3, 3),
    ];
    const out = dedupeProgressiveSlides(blocks);
    expect(pagesOf(out)).toEqual([3]);
    expect(out).toHaveLength(4);
  });
  it('gère les chaînes 2 ⊂ 3 ⊂ 4 : seule la 4 reste', () => {
    const blocks = [
      b(t, 2), b(l1, 2),
      b(t, 3), b(l1, 3), b(l2, 3),
      b(t, 4), b(l1, 4), b(l2, 4), b(l3, 4),
    ];
    expect(pagesOf(dedupeProgressiveSlides(blocks))).toEqual([4]);
  });
  it('conserve deux diapos différentes au même titre', () => {
    const blocks = [b(t, 2), b(l1, 2), b(t, 3), b(l2, 3)];
    const out = dedupeProgressiveSlides(blocks);
    expect(pagesOf(out)).toEqual([2, 3]);
    expect(out).toHaveLength(4);
  });
  it('ne compare que des pages consécutives', () => {
    // 1 ⊂ 3 mais pas 1 ⊂ 2 : la page 1 reste ; 2 ⊂ 3 : la page 2 part.
    const blocks = [b(l1, 1), b(l3, 2), b(`${l1} ${l3}`, 3)];
    expect(pagesOf(dedupeProgressiveSlides(blocks))).toEqual([1, 3]);
    const far = [b(l1, 1), b(l3, 2), b(`${l1} ${l2}`, 3)];
    expect(pagesOf(dedupeProgressiveSlides(far))).toEqual([1, 2, 3]);
  });
  it('ne retire jamais une page au texte normalisé vide', () => {
    const blocks = [b('—', 1), b('Texte', 2)];
    expect(pagesOf(dedupeProgressiveSlides(blocks))).toEqual([1, 2]);
  });
  it('laisse passer les blocs sans page', () => {
    const blocks = [b('A'), b('A'), b('B')];
    expect(dedupeProgressiveSlides(blocks)).toEqual(blocks);
  });
});
