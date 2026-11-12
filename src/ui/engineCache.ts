import type { TtsEngine } from '../tts/engine';

type Disposable = TtsEngine & { dispose?(): void };
type Factory = (voiceId: string, onDownload: (ratio: number) => void) => Promise<Disposable>;

/**
 * Un seul moteur vocal (worker) à la fois, par voix : réutilisé tant que la voix ne change pas,
 * libéré dès qu'une autre voix est demandée. Un échec de création n'est pas mémorisé (on pourra réessayer).
 */
export class EngineCache {
  private current?: { voiceId: string; engine: Promise<Disposable> };
  private downloadListeners = new Set<(ratio: number) => void>();

  constructor(private create: Factory) {}

  get = (voiceId: string): Promise<TtsEngine> => {
    if (this.current?.voiceId === voiceId) return this.current.engine;
    this.release();
    const engine = this.create(voiceId, (r) => this.downloadListeners.forEach((l) => l(r)));
    const entry = { voiceId, engine };
    this.current = entry;
    engine.catch(() => {
      if (this.current === entry) this.current = undefined;
    });
    return engine;
  };

  /** Libère le moteur s'il ne correspond pas à `keepVoiceId` (ou toujours si absent). */
  release(keepVoiceId?: string): void {
    const cur = this.current;
    if (!cur || cur.voiceId === keepVoiceId) return;
    this.current = undefined;
    cur.engine.then((e) => e.dispose?.()).catch(() => undefined);
  }

  onDownload = (l: (ratio: number) => void): (() => void) => {
    this.downloadListeners.add(l);
    return () => {
      this.downloadListeners.delete(l);
    };
  };
}
