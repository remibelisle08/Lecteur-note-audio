import type { Chapter, ChapterFlag } from '../../types';

const FLAGS: Record<ChapterFlag, { icon: string; label: string }> = {
  'ocr-low-confidence': { icon: '⚠️', label: 'Reconnaissance de texte peu fiable' },
  'has-captions': { icon: '🖼️', label: 'Contient des légendes d’images' },
  'has-quiz': { icon: '❓', label: 'Contient un quiz' },
};

type Props = {
  chapter: Chapter;
  position: number;
  isLast: boolean;
  onChange: (patch: Partial<Chapter>, immediate?: boolean) => void;
  onMerge: () => void;
};

export function ChapterEditor({ chapter, position, isLast, onChange, onMerge }: Props) {
  const base = `ch-${chapter.id}`;
  return (
    <article className={`card stack chapter${chapter.included ? '' : ' is-excluded'}`} aria-labelledby={`${base}-n`}>
      <div className="row chapter-head">
        <span id={`${base}-n`} className="chapter-number">
          Chapitre {position}
        </span>
        <span className="flags">
          {(chapter.flags ?? []).map((f) => (
            <span key={f} role="img" aria-label={FLAGS[f].label} title={FLAGS[f].label}>
              {FLAGS[f].icon}
            </span>
          ))}
        </span>
        <label className="check">
          <input
            type="checkbox"
            checked={chapter.included}
            onChange={(e) => onChange({ included: e.target.checked }, true)}
          />
          Inclure
        </label>
      </div>
      <label htmlFor={`${base}-t`}>Titre du chapitre</label>
      <input id={`${base}-t`} value={chapter.title} onChange={(e) => onChange({ title: e.target.value })} />
      <label htmlFor={`${base}-x`}>Texte du chapitre</label>
      <textarea id={`${base}-x`} rows={8} value={chapter.text} onChange={(e) => onChange({ text: e.target.value })} />
      {!isLast && (
        <button type="button" className="btn" onClick={onMerge}>
          Fusionner avec le suivant
        </button>
      )}
    </article>
  );
}
