import { describe, it, expect } from 'vitest';
import type { RawBlock } from '../../src/types';
import { cleanDocument } from '../../src/cleanup';

const S1 = 'Les lipides sont des molécules hydrophobes.';
const S2 = 'Ils constituent une réserve d’énergie.';
const S3 = 'Ils entrent aussi dans les membranes cellulaires.';
const S4 = 'Les sels biliaires émulsifient les graisses alimentaires.';

const title = (text: string, page: number): RawBlock => ({
  text, kind: 'paragraph', page, fontSize: 20, yRatio: 0.15,
});
const body = (text: string, page: number, yRatio: number): RawBlock => ({
  text, kind: 'paragraph', page, fontSize: 12, yRatio,
});
const footer = (n: number): RawBlock => ({
  text: `Chapitre 4 – Lipides · ${n}/13`, kind: 'paragraph', page: n, fontSize: 9, yRatio: 0.97,
});
const num = (n: number): RawBlock => ({
  text: String(n), kind: 'paragraph', page: n, fontSize: 9, yRatio: 0.95,
});

describe('cleanDocument', () => {
  it('enchaîne tout sur un mini-deck', () => {
    const blocks: RawBlock[] = [
      title('Introduction', 1), body(S1, 1, 0.4), num(1), footer(1),
      title('Introduction', 2), body(S1, 2, 0.4), body(S2, 2, 0.5), num(2), footer(2),
      title('Introduction', 3), body(S1, 3, 0.4), body(S2, 3, 0.5), body(S3, 3, 0.6), num(3), footer(3),
      title('Absorption des lipides', 4), body(S4, 4, 0.4), num(4), footer(4),
    ];
    expect(cleanDocument(blocks, 'pdf')).toEqual([
      { title: 'Introduction', text: `${S1}\n\n${S2}\n\n${S3}`, included: true, flags: [] },
      { title: 'Absorption des lipides', text: S4, included: true, flags: [] },
    ]);
  });

  it('DOCX : supprime les chapitres vides', () => {
    const out = cleanDocument(
      [
        { text: 'A', kind: 'heading', level: 1 },
        { text: 'Texte  de   A.', kind: 'paragraph' },
        { text: 'B vide', kind: 'heading', level: 1 },
      ],
      'docx',
    );
    expect(out).toEqual([{ title: 'A', text: 'Texte de A.', included: true, flags: [] }]);
  });
});
