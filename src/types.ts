export type RawBlock = {
  text: string;
  kind: 'heading' | 'paragraph';
  level?: number;
  page?: number;
  fontSize?: number;
  /** 0 = haut de page, 1 = bas */
  yRatio?: number;
  confidence?: number;
};
export type ChapterFlag = 'ocr-low-confidence' | 'has-captions' | 'has-quiz';
export type DraftChapter = { title: string; text: string; included: boolean; flags: ChapterFlag[] };
export type Course = { id: string; name: string; order: number; updatedAt: number };
export type NoteStatus = 'draft' | 'generating' | 'ready';
export type Note = {
  id: string;
  courseId: string;
  title: string;
  sourceFileName: string;
  order: number;
  createdAt: number;
  updatedAt: number;
  status: NoteStatus;
  quizMode: boolean;
  usedOcr: boolean;
};
export type AudioStatus = 'pending' | 'generating' | 'ready' | 'error';
export type Chapter = {
  id: string;
  noteId: string;
  index: number;
  title: string;
  text: string;
  included: boolean;
  durationSec?: number;
  audioStatus: AudioStatus;
  audioLocal: boolean;
  audioDriveId?: string;
  updatedAt: number;
};
export type Progress = {
  noteId: string;
  chapterIndex: number;
  positionSec: number;
  completedChapterIds: string[];
  updatedAt: number;
};
export type Settings = {
  voiceId: string;
  defaultRate: number;
  quizPauseSec: number;
  readPauseInstruction: boolean;
  autoDownloadAudio: boolean;
};
export const DEFAULT_SETTINGS: Settings = {
  voiceId: 'fr_FR-siwis-medium',
  defaultRate: 1,
  quizPauseSec: 8,
  readPauseInstruction: false,
  autoDownloadAudio: true,
};
export type Tombstone = { id: string; kind: 'course' | 'note' | 'chapter'; deletedAt: number };
export type Snapshot = {
  version: 1;
  courses: Course[];
  notes: Note[];
  chapters: Omit<Chapter, 'audioLocal'>[];
  progress: Progress[];
  tombstones: Tombstone[];
};
export type Segment =
  | { kind: 'speech'; text: string }
  | { kind: 'pause'; seconds: number }
  | { kind: 'beep' };
