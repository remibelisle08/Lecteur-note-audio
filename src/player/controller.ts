import type { Library } from '../library/db';
import type { Chapter, Progress } from '../types';

export type QueueItem = {
  noteId: string;
  chapterId: string;
  chapterIndex: number;
  title: string;
  noteTitle: string;
  courseName: string;
};

export type PlayerState = {
  item?: QueueItem;
  queue: QueueItem[];
  index: number;
  playing: boolean;
  position: number;
  duration: number;
  rate: number;
  waitingForAudio: boolean;
  error?: string;
};

const SAVE_EVERY_MS = 5000;
const COMPLETE_RATIO = 0.95;
const RESTART_THRESHOLD_SEC = 3;
const MIN_RATE = 0.75;
const MAX_RATE = 2;
const LOAD_ERROR = 'Impossible de charger ce chapitre. Vérifie ta connexion.';

/**
 * Source audio du chapitre courant :
 * - idle : aucune file ; loading : blob en cours de résolution ; ready : source installée ;
 * - waiting : audio pas encore généré ; error : chargement échoué.
 * Seul le chargement portant le jeton courant modifie `status` ; le jeton n'est incrémenté que
 * juste avant un nouveau chargement (ou dispose), donc un chargement périmé a toujours un successeur
 * qui possède l'état.
 */
type SourceStatus = 'idle' | 'loading' | 'ready' | 'waiting' | 'error';

export class PlayerController {
  private queue: QueueItem[] = [];
  private chapters: Chapter[] = [];
  private index = 0;
  private playing = false;
  private wantPlay = false;
  private status: SourceStatus = 'idle';
  /**
   * Position voulue pour le chapitre courant tant que `audio.currentTime` ne fait pas foi
   * (chargement, attente, erreur, ou source installée sans loadedmetadata). Effacée à loadedmetadata.
   */
  private pendingPos?: number;
  private rate = 1;
  private rateTouched = false;
  private objectUrl?: string;
  private timer?: ReturnType<typeof setInterval>;
  /** Génération du chargement en cours. */
  private token = 0;
  /** Dernière demande de chargement : une demande dépassée avant d'avoir chargé est abandonnée sans effet. */
  private request = 0;
  private progress = new Map<string, Progress>();
  private listeners = new Set<(s: PlayerState) => void>();
  private unsubLib: () => void;

  constructor(
    private audio: HTMLAudioElement,
    private lib: Library,
    private fetchRemoteAudio?: (ch: Chapter) => Promise<Blob | undefined>,
  ) {
    audio.addEventListener('timeupdate', this.onTimeUpdate);
    audio.addEventListener('ended', this.onEnded);
    audio.addEventListener('pause', this.onNativePause);
    audio.addEventListener('durationchange', this.onTimeUpdate);
    this.unsubLib = lib.onChange((kind) => {
      if (kind === 'library' && this.status === 'waiting') void this.retryWaiting();
    });
  }

  // ---------- chargement ----------

  async loadNote(noteId: string): Promise<void> {
    const req = ++this.request;
    this.wantPlay = false;
    await this.ensureRate();
    const note = await this.lib.getNote(noteId);
    if (!note) return;
    const course = (await this.lib.listCourses()).find((c) => c.id === note.courseId);
    const chapters = (await this.lib.listChapters(noteId)).filter((c) => c.included);
    const prog = await this.lib.getProgress(noteId);
    if (req !== this.request) return;
    const my = ++this.token;
    if (prog) this.progress.set(noteId, prog);
    this.setQueue([{ noteTitle: note.title, courseName: course?.name ?? '', chapters }]);
    let start = 0;
    let pos = 0;
    if (prog) {
      const i = this.chapters.findIndex((c) => c.index === prog.chapterIndex);
      if (i >= 0) {
        start = i;
        pos = prog.positionSec;
      }
    }
    await this.loadIndex(start, pos, my);
  }

  async loadCourse(courseId: string): Promise<void> {
    const req = ++this.request;
    this.wantPlay = false;
    await this.ensureRate();
    const course = (await this.lib.listCourses()).find((c) => c.id === courseId);
    const notes = await this.lib.listNotes(courseId);
    const groups: { noteTitle: string; courseName: string; chapters: Chapter[] }[] = [];
    const progs: Progress[] = [];
    for (const note of notes) {
      const chapters = (await this.lib.listChapters(note.id)).filter((c) => c.included);
      const prog = await this.lib.getProgress(note.id);
      if (prog) progs.push(prog);
      groups.push({ noteTitle: note.title, courseName: course?.name ?? '', chapters });
    }
    if (req !== this.request) return;
    const my = ++this.token;
    for (const p of progs) this.progress.set(p.noteId, p);
    this.setQueue(groups);
    if (this.queue.length === 0) {
      this.emit();
      return;
    }
    let start = 0;
    let pos = 0;
    const noteIds = [...new Set(this.queue.map((q) => q.noteId))];
    const target =
      noteIds.find((id) => {
        const done = new Set(this.progress.get(id)?.completedChapterIds ?? []);
        return this.chapters.some((c) => c.noteId === id && !done.has(c.id));
      }) ?? noteIds[0];
    start = this.chapters.findIndex((c) => c.noteId === target);
    const prog = this.progress.get(target);
    if (prog) {
      const i = this.chapters.findIndex((c) => c.noteId === target && c.index === prog.chapterIndex);
      if (i >= 0) {
        start = i;
        pos = prog.positionSec;
      }
    }
    await this.loadIndex(start, pos, my);
  }

  private setQueue(groups: { noteTitle: string; courseName: string; chapters: Chapter[] }[]) {
    this.stopTimer();
    this.playing = false;
    this.status = 'idle';
    this.audio.pause();
    this.chapters = groups.flatMap((g) => g.chapters);
    this.queue = groups.flatMap((g) =>
      g.chapters.map((c) => ({
        noteId: c.noteId,
        chapterId: c.id,
        chapterIndex: c.index,
        title: c.title,
        noteTitle: g.noteTitle,
        courseName: g.courseName,
      })),
    );
    this.index = 0;
  }

  private async ensureRate() {
    if (this.rateTouched) return;
    this.rateTouched = true;
    const s = await this.lib.getSettings();
    this.rate = PlayerController.clampRate(s.defaultRate);
  }

  private static clampRate(r: number): number {
    const rounded = Math.round(r * 4) / 4;
    return Math.min(MAX_RATE, Math.max(MIN_RATE, rounded));
  }

  private async resolveBlob(ch: Chapter): Promise<Blob | undefined> {
    if (ch.audioStatus !== 'ready') return undefined;
    let blob = await this.lib.getAudio(ch.id);
    if (!blob && ch.audioDriveId && this.fetchRemoteAudio) {
      blob = await this.fetchRemoteAudio(ch);
      if (blob) await this.lib.putAudio(ch.id, blob);
    }
    return blob;
  }

  /** Charge le chapitre `i` à `startPos` ; `my` est le jeton de la demande (les chargements périmés sont abandonnés). */
  private async loadIndex(i: number, startPos: number, my: number): Promise<void> {
    if (i < 0 || i >= this.chapters.length) {
      this.emit();
      return;
    }
    this.stopTimer();
    // playing=false avant pause() : le évènement 'pause' asynchrone n'est ainsi pas pris pour une pause utilisateur.
    this.playing = false;
    this.audio.pause();
    this.index = i;
    this.status = 'loading';
    this.pendingPos = startPos;
    let blob: Blob | undefined;
    let failed = false;
    try {
      blob = await this.resolveBlob(this.chapters[i]);
    } catch {
      failed = true;
    }
    if (my !== this.token) return; // le chargement suivant possède l'état
    this.releaseUrl();
    if (!blob) {
      this.clearSource();
      this.status = failed ? 'error' : 'waiting';
      if (failed) this.wantPlay = false;
      this.emit();
      return;
    }
    this.objectUrl = URL.createObjectURL(blob);
    this.audio.src = this.objectUrl;
    this.status = 'ready';
    this.applyRate();
    // Écrit tout de suite (position de départ par défaut) puis réappliqué à loadedmetadata,
    // certains navigateurs ignorant l'écriture ou lisant 0 avant les métadonnées.
    this.audio.currentTime = startPos;
    this.audio.addEventListener('loadedmetadata', () => this.onMetadata(my), { once: true });
    // Lancer la lecture sans attendre IndexedDB (geste utilisateur / iOS verrouillé).
    const started = this.wantPlay ? this.startPlayback(my) : Promise.resolve();
    void this.persist();
    this.emit();
    await started;
  }

  private onMetadata(my: number) {
    if (my !== this.token || this.pendingPos === undefined) return;
    if (this.audio.currentTime !== this.pendingPos) this.audio.currentTime = this.pendingPos;
    this.pendingPos = undefined;
    this.emit();
  }

  private clearSource() {
    this.audio.removeAttribute('src');
    this.audio.load();
  }

  /** Audio en attente : relit le chapitre et le charge s'il est devenu prêt, à la position voulue. */
  private async retryWaiting() {
    const my = this.token;
    const cur = this.chapters[this.index];
    if (this.status !== 'waiting' || !cur) return;
    let fresh: Chapter | undefined;
    try {
      fresh = (await this.lib.listChapters(cur.noteId)).find((c) => c.id === cur.id);
    } catch {
      return;
    }
    // Une autre relance (ou un autre chargement) a pu passer entre-temps.
    if (!fresh || my !== this.token || this.status !== 'waiting') return;
    this.chapters[this.index] = fresh;
    if (fresh.audioStatus === 'ready') await this.loadIndex(this.index, this.pendingPos ?? 0, my);
  }

  // ---------- commandes ----------

  async play(): Promise<void> {
    this.wantPlay = true;
    if (this.status === 'ready') return this.startPlayback(this.token);
    if (this.status === 'error') {
      ++this.request;
      return this.loadIndex(this.index, this.pendingPos ?? 0, ++this.token);
    }
    // idle, loading, waiting : le chargement en cours (ou la reprise automatique) lancera la lecture.
    this.emit();
  }

  private async startPlayback(my: number) {
    try {
      await this.audio.play();
      if (my !== this.token) return;
      this.playing = true;
      this.startTimer();
    } catch (e) {
      if (my !== this.token) return;
      this.playing = false;
      if ((e as { name?: string } | null)?.name === 'NotAllowedError') this.wantPlay = false;
    }
    this.emit();
  }

  pause(): void {
    this.wantPlay = false;
    this.audio.pause();
    this.playing = false;
    this.stopTimer();
    void this.persist();
    this.emit();
  }

  seekBy(sec: number): void {
    this.seekTo(this.position() + sec);
  }

  seekTo(sec: number): void {
    const d = this.audio.duration;
    const max = this.pendingPos === undefined && Number.isFinite(d) && d > 0 ? d : Infinity;
    const v = Math.min(max, Math.max(0, sec));
    if (this.pendingPos !== undefined) this.pendingPos = v;
    else this.audio.currentTime = v;
    this.emit();
  }

  async next(): Promise<void> {
    if (this.index + 1 >= this.queue.length) {
      this.wantPlay = false;
      this.playing = false;
      this.stopTimer();
      await this.persist();
      this.emit();
      return;
    }
    await this.goTo(this.index + 1);
  }

  async prev(): Promise<void> {
    if (this.position() > RESTART_THRESHOLD_SEC || this.index === 0) {
      this.seekTo(0);
      return;
    }
    await this.goTo(this.index - 1);
  }

  async goTo(queueIndex: number): Promise<void> {
    if (queueIndex < 0 || queueIndex >= this.queue.length) return;
    const req = ++this.request;
    await this.persist();
    if (req !== this.request) return;
    await this.loadIndex(queueIndex, 0, ++this.token);
  }

  setRate(r: number): void {
    this.rateTouched = true;
    this.rate = PlayerController.clampRate(r);
    this.applyRate();
    this.emit();
  }

  private applyRate() {
    this.audio.playbackRate = this.rate;
    this.audio.preservesPitch = true;
  }

  subscribe(l: (s: PlayerState) => void): () => void {
    this.listeners.add(l);
    l(this.state());
    return () => {
      this.listeners.delete(l);
    };
  }

  dispose(): void {
    this.token++;
    this.stopTimer();
    this.unsubLib();
    this.audio.removeEventListener('timeupdate', this.onTimeUpdate);
    this.audio.removeEventListener('ended', this.onEnded);
    this.audio.removeEventListener('pause', this.onNativePause);
    this.audio.removeEventListener('durationchange', this.onTimeUpdate);
    this.releaseUrl();
    this.listeners.clear();
  }

  // ---------- événements audio ----------

  private onTimeUpdate = () => {
    this.checkCompleted(false);
    this.emit();
  };

  private onEnded = () => {
    this.checkCompleted(true);
    this.next().catch(() => undefined);
  };

  /** Pause venue du système (interruption, écouteurs) sans passer par pause(). */
  private onNativePause = () => {
    if (!this.audio.paused) return;
    if (this.playing && !this.audio.ended) {
      this.playing = false;
      this.wantPlay = false;
      this.stopTimer();
      void this.persist();
      this.emit();
    }
  };

  // ---------- progression ----------

  private checkCompleted(ended: boolean) {
    const ch = this.chapters[this.index];
    // Tant que la source n'a pas ses métadonnées, currentTime/duration ne concernent pas ce chapitre.
    if (!ch || this.pendingPos !== undefined) return;
    const d = this.audio.duration;
    const ratio = Number.isFinite(d) && d > 0 ? this.audio.currentTime / d : 0;
    if (!ended && ratio < COMPLETE_RATIO) return;
    const p = this.progress.get(ch.noteId);
    if (p?.completedChapterIds.includes(ch.id)) return;
    this.progress.set(ch.noteId, {
      noteId: ch.noteId,
      chapterIndex: p?.chapterIndex ?? ch.index,
      positionSec: p?.positionSec ?? 0,
      completedChapterIds: [...(p?.completedChapterIds ?? []), ch.id],
      updatedAt: Date.now(),
    });
    void this.persist();
  }

  private async persist(): Promise<void> {
    try {
      const ch = this.chapters[this.index];
      if (!ch) return;
      const prev = this.progress.get(ch.noteId);
      const next: Progress = {
        noteId: ch.noteId,
        chapterIndex: ch.index,
        positionSec: this.position(),
        completedChapterIds: prev?.completedChapterIds ?? [],
        updatedAt: Date.now(),
      };
      this.progress.set(ch.noteId, next);
      await this.lib.saveProgress(next);
    } catch {
      /* sauvegarde échouée : réessayée au prochain cycle */
    }
  }

  private startTimer() {
    this.stopTimer();
    this.timer = setInterval(() => void this.persist(), SAVE_EVERY_MS);
  }

  private stopTimer() {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  private releaseUrl() {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = undefined;
  }

  // ---------- état ----------

  /** Position du chapitre courant : la position voulue tant que la source ne fait pas foi. */
  private position(): number {
    return this.pendingPos ?? (this.audio.currentTime || 0);
  }

  private state(): PlayerState {
    const d = this.audio.duration;
    const ch = this.chapters[this.index];
    return {
      item: this.queue[this.index],
      queue: this.queue,
      index: this.index,
      playing: this.playing,
      position: this.position(),
      duration: this.pendingPos === undefined && Number.isFinite(d) && d > 0 ? d : (ch?.durationSec ?? 0),
      rate: this.rate,
      waitingForAudio: this.status === 'waiting',
      error: this.status === 'error' ? LOAD_ERROR : undefined,
    };
  }

  private emit() {
    if (this.listeners.size === 0) return;
    const s = this.state();
    this.listeners.forEach((l) => {
      try {
        l(s);
      } catch {
        /* un abonné défaillant ne doit pas perturber le lecteur */
      }
    });
  }
}
