import { useEffect, useState } from 'react';
import { useApp } from '../AppContext';

/** « Téléchargement de la voix… X % » pendant le premier téléchargement de la voix. */
export function VoiceDownload() {
  const { onVoiceDownload } = useApp();
  const [ratio, setRatio] = useState<number>();
  useEffect(() => onVoiceDownload?.((r) => setRatio(r >= 1 ? undefined : r)), [onVoiceDownload]);
  if (ratio === undefined) return null;
  return (
    <div className="banner" role="status">
      Téléchargement de la voix… {Math.round(ratio * 100)} %
    </div>
  );
}
