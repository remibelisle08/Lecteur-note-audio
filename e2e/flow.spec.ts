import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { makeDocx } from '../tests/fixtures/makeDocx';

test('import → aperçu → génération → lecture → reprise', async ({ page }) => {
  // Fichier Word : 2 épisodes courts, le second contient un quiz.
  const docx = await makeDocx([
    { heading: 1, text: 'Épisode un' },
    { text: 'La cellule est l’unité de base du vivant. Elle contient un noyau.' },
    { heading: 1, text: 'Épisode deux' },
    { text: 'Les mitochondries produisent l’énergie de la cellule.' },
    { text: 'À toi : quel organite produit l’énergie ?' },
    { text: 'Mets sur pause et réponds.' },
    { text: 'Réponse : la mitochondrie.' },
  ]);
  const path = join(mkdtempSync(join(tmpdir(), 'e2e-')), 'cours-biologie.docx');
  writeFileSync(path, Buffer.from(docx));

  // Moteur vocal factice : une seconde de sinusoïde par appel (pas de téléchargement de la voix).
  await page.addInitScript(() => {
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      const el = this;
      if (el.src.startsWith('blob:')) (window as unknown as { __audio?: HTMLMediaElement }).__audio = el;
      return play.call(el);
    };
    (window as unknown as { __TEST_TTS__: unknown }).__TEST_TTS__ = {
      sampleRate: 22050,
      synthesize: async () => {
        const pcm = new Float32Array(22050);
        for (let i = 0; i < pcm.length; i++) pcm[i] = 0.2 * Math.sin((2 * Math.PI * 440 * i) / 22050);
        return pcm;
      },
    };
  });

  await page.goto('./');
  await page.getByRole('link', { name: '+ Ajouter une note' }).click();
  await page.locator('#file-input').setInputFiles(path);

  // Aperçu : 2 chapitres, ❓ sur celui du quiz seulement.
  await expect(page.getByRole('heading', { name: 'Aperçu' })).toBeVisible();
  await expect(page.getByText(/^Chapitre \d+$/)).toHaveCount(2);
  const quizFlags = page.getByRole('img', { name: 'Contient un quiz' });
  await expect(quizFlags).toHaveCount(1);
  await expect(page.locator('article', { has: quizFlags })).toContainText('Chapitre 2');

  await page.getByRole('button', { name: "Générer l'audio" }).click();
  await expect(page.getByText('Prête', { exact: true })).toBeVisible({ timeout: 45_000 });

  // Lecture : la position avance.
  await page.getByRole('button', { name: /^Écouter/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Épisode un' })).toBeVisible();
  // L'élément <audio> n'est pas dans le DOM : on le retrouve via son premier play().
  const currentTime = () =>
    page.evaluate(() => (window as unknown as { __audio?: HTMLAudioElement }).__audio?.currentTime ?? 0);
  await expect.poll(currentTime, { timeout: 15_000 }).toBeGreaterThan(0.5);
  const t = await currentTime();
  await expect.poll(currentTime, { timeout: 10_000 }).toBeGreaterThan(t);

  // Aller au chapitre 2, laisser la position se sauvegarder (pause), recharger : « Reprendre » y revient.
  await page.getByRole('button', { name: 'Épisode deux' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Épisode deux' })).toBeVisible();
  await page.getByRole('button', { name: 'Pause' }).click();

  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Reprendre' })).toBeVisible();
  await expect(page.locator('.resume')).toContainText('Épisode deux');
  await page.getByRole('button', { name: /^Reprendre/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Épisode deux' })).toBeVisible();
});
