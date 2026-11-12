import { verbalize } from '../cleanup/verbalize';
import type { Chapter, Segment } from '../types';

const INSTRUCTION = /^(mets (sur|en) pause|pause|réfléchis)\b/i;
const HEADING = /^#{1,6}[ \t]+/;
const PARAGRAPH_PAUSE = 0.4;
const HEADING_PAUSE = 0.8;
const ENDS_WITH_PUNCT = /[.!?:…]$/;

function paragraphsOf(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function isQuestion(p: string): boolean {
  return /^À toi/i.test(p) || p.endsWith('?');
}

/** Vrai si au moins une consigne de pause suit une question. */
export function detectQuiz(text: string): boolean {
  const ps = paragraphsOf(text);
  return ps.some((p, i) => i > 0 && INSTRUCTION.test(p) && isQuestion(ps[i - 1]));
}

const SENTENCE_END = /[.!?…]/;
const NEXT_START = /[\p{Lu}\p{N}«]/u;

function splitLong(sentence: string, maxChars: number): string[] {
  const out: string[] = [];
  let rest = sentence.trim();
  while (rest.length > maxChars) {
    const comma = rest.lastIndexOf(', ', maxChars - 1);
    const semi = rest.lastIndexOf(' ; ', maxChars - 2);
    let cut = Math.max(comma >= 0 ? comma + 1 : -1, semi >= 0 ? semi + 2 : -1);
    if (cut <= 0) {
      const space = rest.lastIndexOf(' ', maxChars);
      cut = space > 0 ? space : maxChars;
    }
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

export function splitSentences(text: string, maxChars = 300): string[] {
  const t = text.trim();
  const sentences: string[] = [];
  let start = 0;
  for (let i = 0; i < t.length; i++) {
    if (!SENTENCE_END.test(t[i])) continue;
    const ws = /^\s+/.exec(t.slice(i + 1));
    if (!ws || !NEXT_START.test(t[i + 1 + ws[0].length] ?? '')) continue;
    // Abréviation « ex. » (y compris « p. ex. ») : jamais une fin de phrase.
    if (t[i] === '.' && /(^|[^\p{L}])ex$/u.test(t.slice(start, i))) continue;
    sentences.push(t.slice(start, i + 1).trim());
    start = i + 1 + ws[0].length;
  }
  if (start < t.length) sentences.push(t.slice(start).trim());
  return sentences.filter(Boolean).flatMap((s) => splitLong(s, maxChars));
}

function withPeriod(s: string): string {
  return ENDS_WITH_PUNCT.test(s) ? s : `${s}.`;
}

export function buildSegments(
  chapter: Pick<Chapter, 'title' | 'text'>,
  opts: { quizMode: boolean; quizPauseSec: number; readPauseInstruction: boolean },
): Segment[] {
  const out: Segment[] = [];
  let pending = 0; // pause à insérer avant le prochain contenu

  const pushPause = (seconds: number) => {
    const last = out[out.length - 1];
    if (last?.kind === 'pause') last.seconds = Math.max(last.seconds, seconds);
    else out.push({ kind: 'pause', seconds });
  };
  const flush = () => {
    if (pending > 0) pushPause(pending);
    pending = 0;
  };
  const speak = (raw: string, closeWithPeriod: boolean) => {
    const cleaned = verbalize(raw).replace(/\s*\n\s*/g, ' ').trim();
    if (!cleaned) return false;
    flush();
    if (closeWithPeriod) out.push({ kind: 'speech', text: withPeriod(cleaned) });
    else for (const s of splitSentences(cleaned)) out.push({ kind: 'speech', text: s });
    return true;
  };

  const title = chapter.title.trim();
  if (title && speak(title, true)) pending = HEADING_PAUSE;

  const ps = paragraphsOf(chapter.text);
  let quizPause = false;
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    quizPause = false;
    if (HEADING.test(p)) {
      pending = Math.max(pending, HEADING_PAUSE);
      if (speak(p.replace(HEADING, ''), true)) pending = PARAGRAPH_PAUSE;
      continue;
    }
    const isInstruction = INSTRUCTION.test(p) && i > 0 && isQuestion(ps[i - 1]);
    if (isInstruction && opts.quizMode) {
      pending = 0;
      if (opts.readPauseInstruction) {
        pending = PARAGRAPH_PAUSE;
        speak(p, false);
      }
      out.push({ kind: 'beep' }, { kind: 'pause', seconds: opts.quizPauseSec });
      pending = 0;
      quizPause = true;
      continue;
    }
    if (speak(p, false)) pending = PARAGRAPH_PAUSE;
  }
  // Pas de pause finale (sauf le silence de réponse d'un quiz).
  if (!quizPause && out[out.length - 1]?.kind === 'pause') out.pop();
  return out;
}
