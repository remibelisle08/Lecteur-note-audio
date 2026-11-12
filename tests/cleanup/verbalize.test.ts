import { describe, expect, it } from 'vitest';
import { verbalize } from '../../src/cleanup/verbalize';
import source from '../../src/cleanup/verbalize.ts?raw';

describe('verbalize', () => {
  it.each([
    ['Glycolyse → pyruvate', 'Glycolyse, donne pyruvate'],
    ['insuline ↑ · ATP élevé', 'insuline augmente, A T P élevé'],
    ['glucagon ↓', 'glucagon diminue'],
    ['la β-oxydation', 'la bêta-oxydation'],
    ['Phospholipides : ~5 %', 'Phospholipides : environ 5 pour cent'],
    ['1 palmitate = 106 ATP', '1 palmitate égale 106 A T P'],
    ['x ≥ 3', 'x supérieur ou égal à 3'],
    ['ex. lécithine', 'par exemple lécithine'],
    ['les VLDL et les LDL', 'les V L D L et les L D L'],
    ['CPT-I → CAT → CPT-II', 'C P T 1, donne C A T, donne C P T 2'],
    ['GLUT4 et GLUT2', 'glute 4 et glute 2'],
    ['le REL et le RER', 'le R E L et le R E R'],
    ['Palmitate (16 C)', 'Palmitate (16 carbones)'],
    ['Le foie', 'Le foie'],
    ['A', 'A'],
    ["L'ATP", "L'A T P"],
    ['Les acides gras entrent dans la cellule.', 'Les acides gras entrent dans la cellule.'],
    ['Intro\n\n→ pyruvate', 'Intro\n\ndonne pyruvate'],
    ['a\n\n= b', 'a\n\négale b'],
    ['insuline ↑insuline', 'insuline augmente insuline'],
    ['ex.lécithine', 'par exemple lécithine'],
    ['GLUT12', 'glute 12'],
    ['AB12', 'A B 12'],
  ])('%j', (input, expected) => expect(verbalize(input)).toBe(expected));

  it('n\'utilise aucune assertion lookbehind (Safari < 16.4)', () => {
    expect(source).not.toContain('(?<');
  });
});
