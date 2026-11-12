import 'fake-indexeddb/auto';
import { vi } from 'vitest';
import { render } from '@testing-library/react';
import { openLibrary, type Library } from '../../src/library/db';
import type { AppServices, GeneratorLike, PlayerLike } from '../../src/ui/AppContext';
import { App } from '../../src/ui/App';
import type { PlayerState } from '../../src/player/controller';
import type { GeneratorEvent } from '../../src/tts/generator';
import type { Chapter, Course, Note } from '../../src/types';

let n = 0;
export const openTestLibrary = () => openLibrary(`ui-${Date.now()}-${n++}`);

export const words = (count: number, word = 'mot') => Array.from({ length: count }, () => word).join(' ');

export const course = (id: string, name: string, order = 0): Course => ({ id, name, order, updatedAt: 0 });
export const note = (id: string, courseId: string, over: Partial<Note> = {}): Note => ({
  id, courseId, title: 'Note ' + id, sourceFileName: id + '.pdf', order: 0, createdAt: 1, updatedAt: 0,
  status: 'draft', quizMode: false, usedOcr: false, ...over,
});
export const chapter = (id: string, noteId: string, index: number, over: Partial<Chapter> = {}): Chapter => ({
  id, noteId, index, title: 'Chapitre ' + id, text: 'texte', included: true,
  audioStatus: 'pending', audioLocal: false, updatedAt: 0, ...over,
});

export function fakePlayer(initial: Partial<PlayerState> = {}) {
  let state: PlayerState = {
    queue: [], index: 0, playing: false, position: 0, duration: 0, rate: 1, waitingForAudio: false, ...initial,
  };
  const listeners = new Set<(s: PlayerState) => void>();
  const player: PlayerLike = {
    loadNote: vi.fn(async () => undefined),
    loadCourse: vi.fn(async () => undefined),
    play: vi.fn(async () => undefined),
    pause: vi.fn(),
    seekBy: vi.fn(),
    seekTo: vi.fn(),
    next: vi.fn(async () => undefined),
    prev: vi.fn(async () => undefined),
    goTo: vi.fn(async () => undefined),
    setRate: vi.fn(),
    subscribe(l) {
      listeners.add(l);
      l(state);
      return () => listeners.delete(l);
    },
  };
  return {
    player,
    setState(s: Partial<PlayerState>) {
      state = { ...state, ...s };
      listeners.forEach((l) => l(state));
    },
  };
}

export function fakeGenerator() {
  const listeners = new Set<(e: GeneratorEvent) => void>();
  const generator: GeneratorLike & { emit(e: GeneratorEvent): void } = {
    busy: false,
    generateNote: vi.fn(async () => undefined),
    onProgress(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    emit(e) {
      listeners.forEach((l) => l(e));
    },
  };
  return generator;
}

export function makeServices(lib: Library, over: Partial<AppServices> = {}): AppServices {
  return {
    lib,
    generator: fakeGenerator(),
    player: fakePlayer().player,
    importFile: vi.fn(async () => {
      throw new Error('importFile non prévu dans ce test');
    }),
    getEngine: vi.fn(async () => {
      throw new Error('moteur non prévu dans ce test');
    }),
    sourceFiles: new Map(),
    driveConnected: false,
    ...over,
  };
}

export function renderAt(hash: string, services: AppServices) {
  window.location.hash = hash;
  return render(<App services={services} />);
}
