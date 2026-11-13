import { useEffect, useRef, useState } from 'react';
import { unlockElement } from '../../player/unlock';
import { renderChapterToMp3 } from '../../tts/audio';
import { DOWNLOAD_ERROR, listVoices } from '../../tts/engine';
import type { Settings } from '../../types';
import { useApp } from '../AppContext';
import { BackLink } from '../components/BackLink';
import { FALLBACK_ERROR, formatBytes, formatRate, formatSyncTime } from '../format';
import { freeListenedAudio, freedMessage } from '../freeAudio';
import { useDriveState } from '../hooks/useDrive';

const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];
const SAMPLE_TEXT = 'Bonjour ! Voici un aperçu de cette voix pour écouter tes notes de cours.';
const SAMPLE_BUSY = 'Patiente jusqu’à la fin de la génération pour écouter un échantillon.';
const SAVE_ERROR = 'Impossible d’enregistrer ce réglage. Réessaie.';
export const SAMPLE_PLAY_ERROR = 'Impossible de lire l’échantillon.';
export const DRIVE_NOT_CONFIGURED = "La synchro Drive n'est pas configurée sur cette installation (voir README).";
export const DRIVE_CONNECT_ERROR = 'Connexion à Google Drive impossible. Réessaie.';

function useStorageEstimate(): string | undefined {
  const [text, setText] = useState<string>();
  useEffect(() => {
    let alive = true;
    const estimate = navigator.storage?.estimate?.bind(navigator.storage);
    if (!estimate) return;
    estimate()
      .then((e) => {
        if (!alive || e.usage === undefined) return;
        setText(e.quota ? `${formatBytes(e.usage)} sur ${formatBytes(e.quota)}` : formatBytes(e.usage));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return text;
}

export function SettingsScreen() {
  const { lib, generator, getEngine, releaseEngines, driveConnected, notify } = useApp();
  const [settings, setSettings] = useState<Settings>();
  const [sampling, setSampling] = useState(false);
  const sampleAudio = useRef<HTMLAudioElement>();
  const storage = useStorageEstimate();
  const voices = listVoices();

  useEffect(() => {
    lib.getSettings().then(setSettings, () => notify('Impossible de lire tes réglages.'));
  }, [lib, notify]);

  useEffect(
    () => () => {
      sampleAudio.current?.pause();
    },
    [],
  );

  if (!settings) return <p className="muted">Chargement…</p>;

  const update = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    lib.saveSettings(next).catch(() => notify(SAVE_ERROR));
    if (patch.voiceId && !generator.busy) releaseEngines?.(patch.voiceId);
  };

  const playSample = async () => {
    if (generator.busy) {
      notify(SAMPLE_BUSY);
      return;
    }
    // Élément créé et déverrouillé dans le clic (iOS), avant les secondes de synthèse.
    sampleAudio.current?.pause();
    const audio = new Audio();
    sampleAudio.current = audio;
    void unlockElement(audio);
    setSampling(true);
    let blob: Blob;
    try {
      const engine = await getEngine(settings.voiceId);
      blob = (await renderChapterToMp3([{ kind: 'speech', text: SAMPLE_TEXT }], engine)).blob;
    } catch (err) {
      notify(err instanceof Error && err.message === DOWNLOAD_ERROR ? DOWNLOAD_ERROR : FALLBACK_ERROR);
      setSampling(false);
      return;
    }
    setSampling(false);
    if (sampleAudio.current !== audio) return; // un autre échantillon a été demandé
    const url = URL.createObjectURL(blob);
    const release = () => URL.revokeObjectURL(url);
    audio.addEventListener('ended', release, { once: true });
    audio.src = url;
    try {
      await audio.play();
    } catch {
      release();
      notify(SAMPLE_PLAY_ERROR);
    }
  };

  const free = async () => {
    try {
      notify(freedMessage(await freeListenedAudio(lib)));
    } catch {
      notify(FALLBACK_ERROR);
    }
  };

  return (
    <>
      <BackLink />
      <header className="screen-header">
        <h1>Réglages</h1>
      </header>

      <section className="card stack" aria-labelledby="s-voice">
        <h2 id="s-voice">Lecture</h2>
        <label htmlFor="voice">Voix</label>
        <select id="voice" value={settings.voiceId} onChange={(e) => update({ voiceId: e.target.value })}>
          {voices.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
        <button type="button" className="btn" disabled={sampling} onClick={() => void playSample()}>
          {sampling ? 'Préparation de l’échantillon…' : 'Écouter un échantillon'}
        </button>

        <label htmlFor="default-rate">Vitesse par défaut</label>
        <select
          id="default-rate"
          value={settings.defaultRate}
          onChange={(e) => update({ defaultRate: Number(e.target.value) })}
        >
          {RATES.map((r) => (
            <option key={r} value={r}>
              {formatRate(r)}
            </option>
          ))}
        </select>

        <label htmlFor="quiz-pause">
          Durée du silence quiz : <strong>{settings.quizPauseSec} s</strong>
        </label>
        <input
          id="quiz-pause"
          type="range"
          min={3}
          max={15}
          step={1}
          value={settings.quizPauseSec}
          onChange={(e) => update({ quizPauseSec: Number(e.target.value) })}
        />

        <label className="check">
          <input
            type="checkbox"
            checked={settings.readPauseInstruction}
            onChange={(e) => update({ readPauseInstruction: e.target.checked })}
          />
          Lire la consigne de pause
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.autoDownloadAudio}
            onChange={(e) => update({ autoDownloadAudio: e.target.checked })}
          />
          Télécharger automatiquement l'audio
        </label>
      </section>

      <DriveSection />

      <section className="card stack" aria-labelledby="s-storage">
        <h2 id="s-storage">Stockage</h2>
        <p>Espace utilisé : {storage ?? 'inconnu'}</p>
        {driveConnected && (
          <button type="button" className="btn" onClick={() => void free()}>
            Libérer l'audio des notes écoutées
          </button>
        )}
      </section>
    </>
  );
}

function DriveSection() {
  const { drive, notify } = useApp();
  const { configured, connected, status } = useDriveState(drive);
  const [connecting, setConnecting] = useState(false);

  const connect = async () => {
    if (!drive) return;
    setConnecting(true);
    try {
      await drive.connect();
    } catch {
      notify(DRIVE_CONNECT_ERROR);
    } finally {
      setConnecting(false);
    }
  };

  let body: JSX.Element;
  if (!drive || !configured) {
    body = <p className="muted">{DRIVE_NOT_CONFIGURED}</p>;
  } else if (!connected) {
    body = (
      <>
        <p className="muted">
          Retrouve ta bibliothèque et tes audios sur tous tes appareils, dans un dossier « Lecteur de notes » de ton
          Google Drive.
        </p>
        <button type="button" className="btn btn-primary" disabled={connecting} onClick={() => void connect()}>
          Connecter Google Drive
        </button>
      </>
    );
  } else {
    const syncing = status.state === 'syncing';
    body = (
      <>
        <p>
          {syncing
            ? 'Synchronisation en cours…'
            : status.lastSyncAt
              ? `Dernière synchro : ${formatSyncTime(status.lastSyncAt)}`
              : 'Pas encore synchronisé.'}
        </p>
        {status.message && (status.state === 'error' || status.state === 'auth-required') && (
          <p className="error" role="alert">
            {status.message}
          </p>
        )}
        <div className="row">
          <button type="button" className="btn" disabled={syncing} onClick={() => void drive.syncNow()}>
            Synchroniser maintenant
          </button>
          <button type="button" className="btn" onClick={() => drive.disconnect()}>
            Déconnecter
          </button>
        </div>
      </>
    );
  }

  return (
    <section className="card stack" aria-labelledby="s-drive">
      <h2 id="s-drive">Google Drive</h2>
      {body}
    </section>
  );
}
