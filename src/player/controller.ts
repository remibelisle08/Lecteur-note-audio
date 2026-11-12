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

export class PlayerController {
  private queue: QueueItem[] = [];
  private chapters: Chapter[] = [];
  private index = 0;
  private playing = false;
  private wantPlay = false;
  private waiting = false;
  private error?: string;
  private loading = false;
  private rate = 1;
  private rateTouched = false;
  private objectUrl?: string;
  private timer?: ReturnType<typeof setInterval>;
  private token = 0;
  private retrying = false;
  private retryAgain = false;
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
      if (kind === 'library' && this.waiting) void this.retryWaiting();
    });
  }

  // ---------- chargement ----------

  async loadNote(noteId: string): Promise<void> {
    const my = ++this.token;
    this.wantPlay = false;
    await this.ensureRate();
    const note = await this.lib.getNote(noteId);
    if (!note) return;
    const course = (await this.lib.listCourses()).find((c) => c.id === note.courseId);
    const chapters = (await this.lib.listChapters(noteId)).filter((c) => c.included);
    const prog = await this.lib.getProgress(noteId);
    if (my !== this.token) return;
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
    const my = ++this.token;
    this.wantPlay = false;
    await this.ensureRate();
    const course = (await this.lib.listCourses()).find((c) => c.id === courseId);
    const notes = await this.lib.listNotes(courseId);
    const groups: { noteTitle: string; courseName: string; chapters: Chapter[] }[] = [];
    for (const note of notes) {
      const chapters = (await this.lib.listChapters(note.id)).filter((c) => c.included);
      const prog = await this.lib.getProgress(note.id);
      if (prog) this.progress.set(note.id, prog);
      groups.push({ noteTitle: note.title, courseName: course?.name ?? '', chapters });
    }
    if (my !== this.token) return;
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
    this.error = undefined;
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

  /** Charge le chapitre `i` ; `my` est le jeton de la demande (les chargements périmés sont abandonnés). */
  private async loadIndex(i: number, startPos: number, my: number): Promise<void> {
    if (i < 0 || i >= this.chapters.length) {
      this.emit();
      return;
    }
    this.stopTimer();
    // playing=false avant pause() : le évènement 'pause' asynchrone n'est ainsi pas pris pour une pause utilisateur.
    this.playing = false;
    this.error = undefined;
    this.audio.pause();
    this.index = i;
    this.loading = true;
    try {
      const ch = this.chapters[i];
      const blob = await this.resolveBlob(ch);
      if (my !== this.token) return;
      if (!blob) {
        this.releaseUrl();
        this.clearSource();
        this.waiting = true;
        this.loading = false;
        this.emit();
        return;
      }
      this.waiting = false;
      this.loading = false;
      this.releaseUrl();
      this.objectUrl = URL.createObjectURL(blob);
      this.audio.src = this.objectUrl;
      this.applyRate();
      if (startPos > 0) {
        this.audio.currentTime = startPos;
        const onMeta = () => {
          this.audio.removeEventListener('loadedmetadata', onMeta);
          if (my === this.token && this.audio.currentTime !== startPos) this.audio.currentTime = startPos;
          this.emit();
        };
        this.audio.addEventListener('loadedmetadata', onMeta);
      }
      // Lancer la lecture sans attendre IndexedDB (geste utilisateur / iOS verrouillé).
      const started = this.wantPlay ? this.startPlayback(my) : Promise.resolve();
      void this.persist();
      this.emit();
      await started;
    } catch {
      if (my !== this.token) return;
      this.playing = false;
      this.wantPlay = false;
      this.waiting = false;
      this.loading = false;
      this.releaseUrl();
      this.clearSource();
      this.error = LOAD_ERROR;
      this.emit();
    }
  }

  private clearSource() {
    this.audio.removeAttribute('src');
    this.audio.load();
  }

  private async retryWaiting() {
    if (this.retrying) {
      this.retryAgain = true;
      return;
    }
    this.retrying = true;
    try {
      do {
        this.retryAgain = false;
        if (!this.waiting) break;
        const my = this.token;
        const cur = this.chapters[this.index];
        if (!cur) break;
        let fresh: Chapter | undefined;
        try {
          fresh = (await this.lib.listChapters(cur.noteId)).find((c) => c.id === cur.id);
        } catch {
          break;
        }
        if (!fresh || my !== this.token) break;
        this.chapters[this.index] = fresh;
        if (fresh.audioStatus === 'ready') {
          const p = this.progress.get(fresh.noteId);
          await this.loadIndex(this.index, p && p.chapterIndex === fresh.index ? p.positionSec : 0, my);
        }
      } while (this.retryAgain);
    } finally {
      this.retrying = false;
    }
  }

  // ---------- commandes ----------

  async play(): Promise<void> {
    this.wantPlay = true;
    if (this.waiting || this.queue.length === 0) {
      this.emit();
      return;
    }
    if (this.error) {
      await this.loadIndex(this.index, 0, ++this.token);
      return;
    }
    await this.startPlayback(this.token);
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
    this.seekTo(this.audio.currentTime + sec);
  }

  seekTo(sec: number): void {
    const d = this.audio.duration;
    const max = Number.isFinite(d) && d > 0 ? d : Infinity;
    this.audio.currentTime = Math.min(max, Math.max(0, sec));
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
    if (this.audio.currentTime > RESTART_THRESHOLD_SEC || this.index === 0) {
      this.seekTo(0);
      return;
    }
    await this.goTo(this.index - 1);
  }

  async goTo(queueIndex: number): Promise<void> {
    if (queueIndex < 0 || queueIndex >= this.queue.length) return;
    await this.persist();
    const my = ++this.token;
    await this.loadIndex(queueIndex, 0, my);
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
    if (!ch) return;
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
      // Sans audio chargé (attente, erreur, chargement en cours), la position sauvegardée reste intacte.
      if (this.waiting || this.error || this.loading) return;
      const ch = this.chapters[this.index];
      if (!ch) return;
      const prev = this.progress.get(ch.noteId);
      const next: Progress = {
        noteId: ch.noteId,
        chapterIndex: ch.index,
        positionSec: this.audio.currentTime || 0,
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

  private state(): PlayerState {
    const d = this.audio.duration;
    const ch = this.chapters[this.index];
    return {
      item: this.queue[this.index],
      queue: this.queue,
      index: this.index,
      playing: this.playing,
      position: this.audio.currentTime || 0,
      duration: Number.isFinite(d) && d > 0 ? d : (ch?.durationSec ?? 0),
      rate: this.rate,
      waitingForAudio: this.waiting,
      error: this.error,
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
