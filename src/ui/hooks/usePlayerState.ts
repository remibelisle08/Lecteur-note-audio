import { useEffect, useState } from 'react';
import type { PlayerState } from '../../player/controller';
import { useApp } from '../AppContext';

const INITIAL: PlayerState = {
  queue: [], index: 0, playing: false, position: 0, duration: 0, rate: 1, waitingForAudio: false,
};

export function usePlayerState(): PlayerState {
  const { player } = useApp();
  const [state, setState] = useState<PlayerState>(INITIAL);
  useEffect(() => player.subscribe(setState), [player]);
  return state;
}

/** Un élément est-il chargé dans le lecteur ? (ne provoque un rendu que lorsque la réponse change) */
export function usePlayerHasItem(): boolean {
  const { player } = useApp();
  const [has, setHas] = useState(false);
  useEffect(() => player.subscribe((s) => setHas(!!s.item)), [player]);
  return has;
}
