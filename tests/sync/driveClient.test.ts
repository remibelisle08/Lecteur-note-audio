import { describe, expect, it } from 'vitest';
import { buildMultipartBody, folderQuery, fileInFolderQuery, DriveAuthError } from '../../src/sync/driveClient';

function readText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsText(blob);
  });
}

describe('driveClient — fonctions pures', () => {
  it('requête du dossier « Lecteur de notes »', () => {
    expect(folderQuery()).toBe(
      "name='Lecteur de notes' and mimeType='application/vnd.google-apps.folder' and trashed=false",
    );
  });

  it('requête d’un fichier par nom dans le dossier (apostrophes échappées)', () => {
    expect(fileInFolderQuery('library.json', 'abc')).toBe("name='library.json' and 'abc' in parents and trashed=false");
    expect(fileInFolderQuery("l'x", 'abc')).toBe("name='l\\'x' and 'abc' in parents and trashed=false");
  });

  it('corps multipart : métadonnées JSON puis contenu', async () => {
    const { body, contentType } = buildMultipartBody(
      { name: 'chapter-1.mp3', parents: ['f'] },
      new Blob(['DATA'], { type: 'audio/mpeg' }),
      'audio/mpeg',
      'BOUNDARY',
    );
    expect(contentType).toBe('multipart/related; boundary=BOUNDARY');
    expect(await readText(body)).toBe(
      '--BOUNDARY\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
        '{"name":"chapter-1.mp3","parents":["f"]}\r\n' +
        '--BOUNDARY\r\nContent-Type: audio/mpeg\r\n\r\nDATA\r\n--BOUNDARY--',
    );
  });

  it('DriveAuthError est une Error identifiable', () => {
    const e = new DriveAuthError();
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('DriveAuthError');
  });
});
