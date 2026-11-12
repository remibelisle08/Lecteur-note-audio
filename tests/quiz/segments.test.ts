import { describe, it, expect } from 'vitest';
import { buildSegments, detectQuiz, splitSentences } from '../../src/quiz/segments';

const QUIZ = `À toi : Quel est le type de lipide le plus abondant dans notre alimentation ?\n\nMets sur pause et réponds.\n\nRéponse : Ce sont les triglycérides.`;
const Q = 'À toi : Quel est le type de lipide le plus abondant dans notre alimentation ?';
const opts = { quizMode: true, quizPauseSec: 8, readPauseInstruction: false };

describe('detectQuiz', () => {
  it('détecte le modèle quiz', () => expect(detectQuiz(QUIZ)).toBe(true));
  it('refuse une consigne sans question', () => {
    expect(detectQuiz('Introduction.\n\nMets sur pause et réponds.')).toBe(false);
    expect(detectQuiz('Un texte simple.')).toBe(false);
  });
});

describe('buildSegments', () => {
  it('insère bip + silence à la place de la consigne', () => {
    const s = buildSegments({ title: 'Épisode 1', text: QUIZ }, opts);
    expect(s).toEqual([
      { kind: 'speech', text: 'Épisode 1.' }, { kind: 'pause', seconds: 0.8 },
      { kind: 'speech', text: Q },
      { kind: 'beep' }, { kind: 'pause', seconds: 8 },
      { kind: 'speech', text: 'Réponse : Ce sont les triglycérides.' },
    ]);
  });
  it('lit la consigne si readPauseInstruction', () => {
    const s = buildSegments({ title: 'Épisode 1', text: QUIZ }, { ...opts, readPauseInstruction: true });
    expect(s.slice(2)).toEqual([
      { kind: 'speech', text: Q },
      { kind: 'pause', seconds: 0.4 },
      { kind: 'speech', text: 'Mets sur pause et réponds.' },
      { kind: 'beep' }, { kind: 'pause', seconds: 8 },
      { kind: 'speech', text: 'Réponse : Ce sont les triglycérides.' },
    ]);
  });
  it('quizMode false : consigne lue, aucun silence long', () => {
    const s = buildSegments({ title: 'Épisode 1', text: QUIZ }, { ...opts, quizMode: false });
    expect(s.slice(2)).toEqual([
      { kind: 'speech', text: Q },
      { kind: 'pause', seconds: 0.4 },
      { kind: 'speech', text: 'Mets sur pause et réponds.' },
      { kind: 'pause', seconds: 0.4 },
      { kind: 'speech', text: 'Réponse : Ce sont les triglycérides.' },
    ]);
    expect(s.some((x) => x.kind === 'beep')).toBe(false);
  });
  it('pause 0,4 s entre paragraphes et 0,8 s avant un « ## » (titre lu sans les #)', () => {
    const s = buildSegments({ title: 'T', text: 'Un.\n\nDeux.\n\n## Section\n\nTrois.' }, opts);
    expect(s).toEqual([
      { kind: 'speech', text: 'T.' }, { kind: 'pause', seconds: 0.8 },
      { kind: 'speech', text: 'Un.' }, { kind: 'pause', seconds: 0.4 },
      { kind: 'speech', text: 'Deux.' }, { kind: 'pause', seconds: 0.8 },
      { kind: 'speech', text: 'Section.' }, { kind: 'pause', seconds: 0.4 },
      { kind: 'speech', text: 'Trois.' },
    ]);
  });
  it('un « ## » en tête fusionne avec la pause du titre, sans pause finale', () => {
    const s = buildSegments({ title: 'Titre ?', text: '## Début\n\nTexte.' }, opts);
    expect(s).toEqual([
      { kind: 'speech', text: 'Titre ?' }, { kind: 'pause', seconds: 0.8 },
      { kind: 'speech', text: 'Début.' }, { kind: 'pause', seconds: 0.4 },
      { kind: 'speech', text: 'Texte.' },
    ]);
    expect(buildSegments({ title: 'Seul', text: '' }, opts)).toEqual([{ kind: 'speech', text: 'Seul.' }]);
  });
  it('découpe un paragraphe en phrases sans pause entre elles', () => {
    const s = buildSegments({ title: 'T', text: 'Première phrase. Deuxième phrase.' }, opts);
    expect(s.slice(2)).toEqual([
      { kind: 'speech', text: 'Première phrase.' },
      { kind: 'speech', text: 'Deuxième phrase.' },
    ]);
  });
  it('applique verbalize au texte parlé', () => {
    const s = buildSegments({ title: 'T', text: "L'ATP est produite." }, opts);
    expect(s[2]).toEqual({ kind: 'speech', text: "L'A T P est produite." });
  });
});

describe('splitSentences', () => {
  it('coupe après . ! ? … suivis d’une majuscule, d’un chiffre ou de «', () => {
    expect(splitSentences('Un. Deux ! Trois ? Quatre… Cinq. 6 fois. « Fin ».')).toEqual([
      'Un.', 'Deux !', 'Trois ?', 'Quatre…', 'Cinq.', '6 fois.', '« Fin ».',
    ]);
  });
  it('ne coupe pas avant une minuscule (etc., ex.)', () => {
    expect(splitSentences('Il y a du pain, etc. et du lait. Fin.')).toEqual(['Il y a du pain, etc. et du lait.', 'Fin.']);
  });
  it('ne coupe pas après « ex. » ni « p. ex. »', () => {
    expect(splitSentences('Voir ex. Glucose et p. ex. 3 g.')).toEqual(['Voir ex. Glucose et p. ex. 3 g.']);
  });
  it('ne coupe pas dans les nombres', () => {
    expect(splitSentences('Il faut 1,5 g et 3.5 mg. Fin.')).toEqual(['Il faut 1,5 g et 3.5 mg.', 'Fin.']);
  });
  it('ne dépasse jamais maxChars : coupe à la dernière virgule', () => {
    const s = 'mot '.repeat(20).trim() + ', ' + 'mot '.repeat(20).trim();
    const out = splitSentences(s, 100);
    expect(out.every((c) => c.length <= 100)).toBe(true);
    expect(out[0].endsWith(',')).toBe(true);
    expect(out.join(' ')).toBe(s);
  });
  it('coupe à « ; » puis à l’espace, et jamais au-delà de 300 par défaut', () => {
    const semi = 'a'.repeat(30) + ' ; ' + 'b'.repeat(30);
    expect(splitSentences(semi, 40)).toEqual(['a'.repeat(30) + ' ;', 'b'.repeat(30)]);
    const long = 'lipide '.repeat(120).trim();
    const out = splitSentences(long);
    expect(out.length).toBeGreaterThan(1);
    expect(out.every((c) => c.length <= 300)).toBe(true);
    expect(out.join(' ')).toBe(long);
  });
  it('coupe dur un mot plus long que maxChars', () => {
    expect(splitSentences('x'.repeat(25), 10).every((c) => c.length <= 10)).toBe(true);
  });
});
