# Lecteur de notes audio — Plan d'implémentation (v1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PWA gratuite qui transforme des notes de cours PDF/DOCX en audio MP3 par chapitre (voix Piper dans le navigateur), écoutable écran verrouillé, avec bibliothèque locale et synchro Google Drive optionnelle.

**Architecture:** Application 100 % client (Vite + React + TS) hébergée sur GitHub Pages. Pipeline : import (pdf.js / mammoth / Tesseract) → nettoyage pur → segments (texte, pauses quiz) → synthèse Piper dans un Web Worker → MP3 encodé en flux → IndexedDB. Un lecteur `<audio>` + Media Session joue les chapitres. Un moteur de synchro fusionne la bibliothèque avec un dossier Drive.

**Tech Stack:** Vite 6, React 18, TypeScript 5, Vitest, fake-indexeddb, Playwright, `pdfjs-dist`, `mammoth`, `tesseract.js@5`, `@diffusionstudio/vits-web`, `@breezystack/lamejs`, `idb`, `vite-plugin-pwa`, Google Identity Services + Drive REST v3. Fixtures de test générées avec `pdf-lib` et `docx` (dépendances de dev).

**Spec:** `docs/superpowers/specs/2026-11-12-lecteur-notes-audio-design.md`

## Global Constraints

- 100 % gratuit : aucune API payante, aucune clé secrète. Seul identifiant : l'ID client OAuth Google (public), lu via `import.meta.env.VITE_GOOGLE_CLIENT_ID` ; absent → section Drive masquée avec explication.
- Interface entièrement en français. Identifiants de code en anglais.
- Formats acceptés : `.pdf`, `.docx`. `.doc` → message « Réenregistre ce fichier en .docx ».
- Audio : MP3 mono, 48 kb/s, fréquence d'échantillonnage de la voix (22 050 Hz pour Piper medium).
- Voix par défaut : `fr_FR-siwis-medium`. Autres proposées : `fr_FR-upmc-medium`, `fr_FR-tom-medium` (vérifier contre `tts.voices()` de vits-web ; ne garder que celles qui existent).
- Vitesse : 0,75× à 2×, pas de 0,25. Sauts ±15 s. Position sauvegardée toutes les 5 s et à la pause. Chapitre « écouté » à ≥ 95 %.
- Durée estimée : 150 mots/min à 1×.
- Quiz : silence défaut 8 s, réglable 3–15 s, précédé d'un bip (880 Hz, 0,25 s, amplitude 0,3).
- Pauses de lecture : 0,4 s entre paragraphes, 0,8 s avant un titre de section (h2).
- Seuil PDF sans texte : moyenne < 50 caractères extraits par page → OCR. Avertissement OCR si confiance < 70.
- Titre PDF : taille de police ≥ 1,2 × médiane du corps et ligne ≤ 80 caractères.
- Sans titre détecté : découpage en sections de ~10 min (1 500 mots) aux limites de paragraphes.
- En-tête/pied : ligne normalisée (chiffres → `#`) répétée sur ≥ 50 % des pages, dans les 10 % supérieurs ou inférieurs de la page.
- Drive : portée `https://www.googleapis.com/auth/drive.file` uniquement ; dossier `Lecteur de notes` ; fichiers `library.json` et `chapter-<id>.mp3`.
- Synchro : agrégation 5 s après une modification ; position toutes les 30 s pendant l'écoute ; au lancement ; à l'événement `online`.
- Aucun fichier de cours complet de l'utilisateur dans le dépôt (public) : extraits courts seulement, réécrits en texte dans les tests.
- Vite `base: '/Lecteur-note-audio/'`.

## Review Focus

1. **Chapitre très long (1 h+)** : 1 h de PCM float32 à 22 050 Hz ≈ 320 Mo → plantage sur téléphone. Attendu : encodage MP3 en flux, phrase par phrase, mémoire bornée. Test dans Task 8 (`renderChapterToMp3` n'accumule jamais plus d'un segment).
2. **Symboles fréquents dans les notes de sciences** (`→`, `↑`, `↓`, `β`, `α`, `~`, `%`, `=`, `≥`, `ex.`) : Piper les ignore ou les lit mal. Attendu : verbalisés en français. Test dans Task 3 (`verbalize`).
3. **Sigles en majuscules** (`LDL`, `VLDL`, `HDL`, `ATP`, `LPL`, `CPT-I`, `REL`) : lus comme des mots. Attendu : épelés (« L D L »), sauf ceux d'une table de prononciation explicite (`GLUT` → « glute »). Test dans Task 3.
4. **App fermée pendant la génération** : chapitres restés `generating`. Attendu : remis à `pending` au démarrage et la génération reprend au premier non prêt. Test dans Task 9.
5. **`library.json` distant corrompu ou absent** : attendu — absent = bibliothèque vide ; corrompu = synchro annulée avec erreur visible, **jamais** d'écrasement du fichier distant. Test dans Task 13.

---

## Structure des fichiers

```
src/
  types.ts                      Types partagés (RawBlock, DraftChapter, Course, Note, Chapter, Progress, Settings, Snapshot, Tombstone, Segment)
  cleanup/
    normalize.ts                Recollage de lignes, césures, numéros de page, artefacts OCR
    verbalize.ts                Symboles et sigles → français prononçable
    pages.ts                    En-têtes/pieds, diapos progressives
    chapters.ts                 Détection de chapitres (PDF, DOCX, repli 10 min)
    index.ts                    cleanDocument() : enchaîne le pipeline
  quiz/segments.ts              buildSegments() : chapitre → Segment[] (quiz, pauses)
  import/
    docx.ts                     DOCX → RawBlock[]
    pdf.ts                      PDF (texte) → RawBlock[] + détection sans texte
    ocr.ts                      PDF (images) → RawBlock[] via Tesseract
    index.ts                    importFile() : aiguillage par type
  library/
    db.ts                       Bibliothèque IndexedDB + événements de changement
  tts/
    engine.ts                   Interface TtsEngine + implémentation worker
    tts.worker.ts               Piper (vits-web) dans un Web Worker
    audio.ts                    WAV→PCM, silence, bip, renderChapterToMp3 (flux)
    generator.ts                File de génération par note, reprise
  player/
    controller.ts               PlayerController (file, vitesse, position)
    mediaSession.ts             Branchement Media Session API
  sync/
    merge.ts                    mergeSnapshots() pur
    driveClient.ts              GIS + Drive REST
    syncEngine.ts               Orchestration et déclencheurs
  ui/
    App.tsx, routes.ts          Routage par hash
    screens/LibraryScreen.tsx, CourseScreen.tsx, ImportScreen.tsx, PreviewScreen.tsx, PlayerScreen.tsx, SettingsScreen.tsx
    components/MiniPlayer.tsx, ProgressBar.tsx, InstallHint.tsx
    styles.css
  main.tsx
tests/                          Miroir de src/ ; tests/fixtures/ pour les générateurs de fixtures
e2e/                            Playwright
.github/workflows/ci.yml        Tests + build + déploiement Pages (main)
```

---

### Task 1: Échafaudage, types partagés, CI/déploiement

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`, `src/ui/App.tsx`, `src/types.ts`, `tests/smoke.test.tsx`, `.github/workflows/ci.yml`, `.gitignore`

**Interfaces:**
- Produces (`src/types.ts`) :

```ts
export type RawBlock = { text: string; kind: 'heading' | 'paragraph'; level?: number;
  page?: number; fontSize?: number; yRatio?: number /* 0 = haut de page, 1 = bas */; confidence?: number };
export type DraftChapter = { title: string; text: string; included: boolean; flags: ChapterFlag[] };
export type ChapterFlag = 'ocr-low-confidence' | 'has-captions' | 'has-quiz';
export type Course = { id: string; name: string; order: number; updatedAt: number };
export type NoteStatus = 'draft' | 'generating' | 'ready';
export type Note = { id: string; courseId: string; title: string; sourceFileName: string; order: number;
  createdAt: number; updatedAt: number; status: NoteStatus; quizMode: boolean; usedOcr: boolean };
export type AudioStatus = 'pending' | 'generating' | 'ready' | 'error';
export type Chapter = { id: string; noteId: string; index: number; title: string; text: string;
  included: boolean; durationSec?: number; audioStatus: AudioStatus; audioLocal: boolean;
  audioDriveId?: string; updatedAt: number };
export type Progress = { noteId: string; chapterIndex: number; positionSec: number;
  completedChapterIds: string[]; updatedAt: number };
export type Settings = { voiceId: string; defaultRate: number; quizPauseSec: number;
  readPauseInstruction: boolean; autoDownloadAudio: boolean };
export const DEFAULT_SETTINGS: Settings = { voiceId: 'fr_FR-siwis-medium', defaultRate: 1,
  quizPauseSec: 8, readPauseInstruction: false, autoDownloadAudio: true };
export type Tombstone = { id: string; kind: 'course' | 'note' | 'chapter'; deletedAt: number };
export type Snapshot = { version: 1; courses: Course[]; notes: Note[];
  chapters: Omit<Chapter, 'audioLocal'>[]; progress: Progress[]; tombstones: Tombstone[] };
export type Segment = { kind: 'speech'; text: string } | { kind: 'pause'; seconds: number } | { kind: 'beep' };
```

- [ ] **Step 1:** Créer le projet Vite React-TS, ajouter Vitest (`environment: 'jsdom'`), `@testing-library/react`, scripts `dev`, `build`, `test` (`vitest run`), `e2e`. `base: '/Lecteur-note-audio/'`.
- [ ] **Step 2: Test smoke** — `tests/smoke.test.tsx` : `render(<App />)` ; `expect(screen.getByRole('heading', { name: 'Mes cours' })).toBeInTheDocument()`.
- [ ] **Step 3:** `npm test` → FAIL (App inexistant). Créer `App.tsx` minimal avec `<h1>Mes cours</h1>`. `npm test` → PASS.
- [ ] **Step 4:** `src/types.ts` tel que ci-dessus. `npx tsc --noEmit` → aucune erreur.
- [ ] **Step 5:** `.github/workflows/ci.yml` : sur push/PR → `npm ci`, `npm test`, `npm run build` ; sur push `main` → `actions/upload-pages-artifact` (`dist`) + `actions/deploy-pages`. Variable `VITE_GOOGLE_CLIENT_ID: ${{ vars.VITE_GOOGLE_CLIENT_ID }}` au build.
- [ ] **Step 6:** `npm run build` → `dist/` produit. Commit `chore: échafaudage Vite/React/TS, types, CI`.

---

### Task 2: Nettoyage — normalisation du texte

**Files:**
- Create: `src/cleanup/normalize.ts`
- Test: `tests/cleanup/normalize.test.ts`

**Interfaces:**
- Produces: `joinLines(blocks: RawBlock[]): RawBlock[]`, `removePageNumbers(blocks: RawBlock[]): RawBlock[]`, `stripOcrArtifacts(text: string): string`, `normalizeWhitespace(text: string): string`

- [ ] **Step 1: Tests**

```ts
it('recolle une césure de fin de ligne', () => {
  const out = joinLines([p('les mouvements de con-', 1), p('traction cisaillent', 1)]);
  expect(out.map(b => b.text)).toEqual(['les mouvements de contraction cisaillent']);
});
it('fusionne les lignes d’un même paragraphe, pas après une ponctuation finale', () => {
  const out = joinLines([p('Les micelles contenant les produits', 1), p('de dégradation entrent.', 1), p('Une fois dans la cellule', 1)]);
  expect(out.map(b => b.text)).toEqual(['Les micelles contenant les produits de dégradation entrent.', 'Une fois dans la cellule']);
});
it('ne fusionne jamais un titre ni à travers les pages', () => { /* heading reste seul ; page 1 / page 2 séparés */ });
it('retire les numéros de page isolés', () => {
  const out = removePageNumbers([p('12'), p('- 12 -'), p('Page 3 de 40'), p('Chapitre 4 (partie 2) – Lipides · 2/13'), p('90 à 95 %')]);
  expect(out.map(b => b.text)).toEqual(['Chapitre 4 (partie 2) – Lipides · 2/13', '90 à 95 %']);
});
it('retire les pastilles OCR en début de paragraphe', () => {
  expect(stripOcrArtifacts('ŒZ) Le défi. L’intestin')).toBe('Le défi. L’intestin');
  expect(stripOcrArtifacts('Œ2 Sources de lipides.')).toBe('Sources de lipides.');
  expect(stripOcrArtifacts('© Après la livraison.')).toBe('Après la livraison.');
  expect(stripOcrArtifacts('@D La LPL.')).toBe('La LPL.');
});
```
(`p(text, page?)` = fabrique de `RawBlock` paragraphe dans le fichier de test.)

- [ ] **Step 2:** `npx vitest run tests/cleanup/normalize.test.ts` → FAIL.
- [ ] **Step 3:** Implémenter. Règles : fusion si même page, aucun des deux n'est `heading`, et la ligne précédente ne finit pas par `.`, `!`, `?`, `:` ; césure = précédente finit par `-` précédé d'une lettre et suivante commence par une minuscule → concaténer sans tiret. Pastille OCR = au début, séquence de 1–3 caractères non alphabétiques latins ou `Œ`/`©`/`@` + au plus 2 caractères alphanumériques, suivie d'un espace puis d'une majuscule. Lignes de < 3 lettres alphabétiques supprimées.
- [ ] **Step 4:** Tests → PASS. Commit `feat(cleanup): normalisation des lignes et artefacts`.

---

### Task 3: Nettoyage — verbalisation (symboles et sigles)

**Files:**
- Create: `src/cleanup/verbalize.ts`
- Test: `tests/cleanup/verbalize.test.ts`

**Interfaces:**
- Produces: `verbalize(text: string): string` — appliqué uniquement au texte envoyé à la voix (le texte affiché à l'aperçu reste original).

- [ ] **Step 1: Tests**

```ts
it.each([
  ['Glycolyse → pyruvate', 'Glycolyse, donne pyruvate'],
  ['insuline ↑ · ATP élevé', 'insuline augmente, A T P élevé'],
  ['glucagon ↓', 'glucagon diminue'],
  ['la β-oxydation', 'la bêta-oxydation'],
  ['Phospholipides : ~5 %', 'Phospholipides : environ 5 pour cent'],
  ['1 palmitate = 106 ATP', '1 palmitate égale 106 A T P'],
  ['x ≥ 3', 'x supérieur ou égal à 3'],
  ['ex. lécithine', 'par exemple lécithine'],
  ['les VLDL et les LDL', 'les V L D L et les L D L'],
  ['CPT-I → CAT → CPT-II', 'C P T 1, donne C A T, donne C P T 2'],
  ['GLUT4 et GLUT2', 'glute 4 et glute 2'],
  ['le REL et le RER', 'le R E L et le R E R'],
  ['Palmitate (16 C)', 'Palmitate (16 carbones)'],
])('%s', (input, expected) => expect(verbalize(input)).toBe(expected));
```

- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Implémenter avec une table de remplacements ordonnée. Sigles : tout jeton de 2 à 6 majuscules (optionnellement suivi de chiffres) est épelé lettre par lettre, chiffres séparés ; suffixes `-I`, `-II`, `-III` → ` 1`, ` 2`, ` 3`. Table de prononciation explicite `PRONOUNCE: Record<string,string> = { GLUT: 'glute' }` (extensible). `·` → `,`. `(16 C)` / `(n C)` → `(n carbones)`.
- [ ] **Step 4:** → PASS. Commit `feat(cleanup): verbalisation des symboles et sigles`.

---

### Task 4: Nettoyage — pages (en-têtes/pieds, diapos progressives)

**Files:**
- Create: `src/cleanup/pages.ts`
- Test: `tests/cleanup/pages.test.ts`

**Interfaces:**
- Produces: `removeHeadersFooters(blocks: RawBlock[]): RawBlock[]`, `dedupeProgressiveSlides(blocks: RawBlock[]): RawBlock[]`

- [ ] **Step 1: Tests**

```ts
it('retire un pied de page répété avec numéro variable', () => {
  // 4 pages ; chaque page a un bloc yRatio 0.97 « Chapitre 4 (partie 2) – Lipides · N/13 »
  expect(out.some(b => b.text.includes('Lipides ·'))).toBe(false);
});
it('garde une ligne répétée au milieu de la page', () => { /* yRatio 0.5 sur 4 pages → conservée */ });
it('garde une ligne en bas de page présente sur < 50 % des pages', () => {});
it('supprime une diapo dont le texte est contenu dans la suivante', () => {
  // page 2 : « Défi physico-chimique » + 2 paragraphes ; page 3 : mêmes + « Pour éviter ce problème, l’organisme utilise l’émulsion »
  expect(pagesOf(out)).toEqual([3]);
});
it('conserve deux diapos différentes au même titre', () => {});
```

- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Implémenter. Comparaison de diapos : texte de page normalisé (minuscules, espaces compactés, ponctuation retirée) ; la page N est retirée si son texte est une sous-chaîne de celui de N+1. En-têtes/pieds : clé = texte normalisé avec `\d+` → `#` ; zone = `yRatio < 0.1 || yRatio > 0.9`.
- [ ] **Step 4:** → PASS. Commit `feat(cleanup): en-têtes, pieds et diapos progressives`.

---

### Task 5: Nettoyage — chapitres et pipeline complet

**Files:**
- Create: `src/cleanup/chapters.ts`, `src/cleanup/index.ts`
- Test: `tests/cleanup/chapters.test.ts`, `tests/cleanup/index.test.ts`

**Interfaces:**
- Consumes: Tasks 2–4.
- Produces: `detectChapters(blocks: RawBlock[], source: 'pdf' | 'docx'): DraftChapter[]`, `cleanDocument(blocks: RawBlock[], source: 'pdf' | 'docx'): DraftChapter[]`, `estimateMinutes(text: string): number`

- [ ] **Step 1: Tests**

```ts
it('PDF : titre par taille de police', () => {
  // corps fontSize 12 ; « Absorption des lipides » fontSize 20 → 2 chapitres
});
it('PDF : titres consécutifs identiques fusionnés en un chapitre', () => {
  // « Introduction » en tête de 5 pages → 1 chapitre « Introduction » contenant tout le texte, titre non répété dans text
});
it('DOCX : h1 = chapitres, h2 conservés comme marqueurs « ## » dans text', () => {
  const ch = detectChapters([h(1,'Épisode 1 – Le voyage du gras'), h(2,'Les lipides de notre alimentation'), p('Dans notre alimentation…'), h(1,'Épisode 2')], 'docx');
  expect(ch.map(c => c.title)).toEqual(['Épisode 1 – Le voyage du gras', 'Épisode 2']);
  expect(ch[0].text).toContain('## Les lipides de notre alimentation');
});
it('sans titre : découpe ~1500 mots aux limites de paragraphes', () => {
  // 4000 mots en paragraphes de 100 → 3 chapitres « Partie 1/2/3 », aucun paragraphe coupé
});
it('marque les légendes courtes isolées', () => { /* bloc < 8 mots sans ponctuation finale entouré de paragraphes → flags contient 'has-captions' */ });
it('estimateMinutes : 1500 mots → 10', () => expect(estimateMinutes(words(1500))).toBe(10));
it('cleanDocument enchaîne tout sur un mini-deck de diapos', () => {
  // pages progressives + pied « · N/13 » + numéros de page + titres « Introduction » → texte attendu exact
});
```

- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Implémenter. Ordre de `cleanDocument` (PDF) : `removeHeadersFooters` → `removePageNumbers` → `dedupeProgressiveSlides` → `stripOcrArtifacts` (par bloc) → `joinLines` → `detectChapters`. DOCX : `joinLines` → `detectChapters`. Paragraphes séparés par `\n\n` dans `text`. Tous les chapitres `included: true`.
- [ ] **Step 4:** → PASS. Commit `feat(cleanup): chapitres et pipeline`.

---

### Task 6: Segments audio et mode quiz

**Files:**
- Create: `src/quiz/segments.ts`
- Test: `tests/quiz/segments.test.ts`

**Interfaces:**
- Consumes: `verbalize` (Task 3), `Segment`, `Settings`.
- Produces: `detectQuiz(text: string): boolean`, `buildSegments(chapter: Pick<Chapter,'title'|'text'>, opts: { quizMode: boolean; quizPauseSec: number; readPauseInstruction: boolean }): Segment[]`, `splitSentences(text: string, maxChars = 300): string[]`

- [ ] **Step 1: Tests** (extraits du script Word de l'utilisateur)

```ts
const QUIZ = `À toi : Quel est le type de lipide le plus abondant dans notre alimentation ?\n\nMets sur pause et réponds.\n\nRéponse : Ce sont les triglycérides.`;
it('détecte le modèle quiz', () => expect(detectQuiz(QUIZ)).toBe(true));
it('insère bip + silence à la place de la consigne', () => {
  const s = buildSegments({ title: 'Épisode 1', text: QUIZ }, { quizMode: true, quizPauseSec: 8, readPauseInstruction: false });
  expect(s).toEqual([
    { kind: 'speech', text: 'Épisode 1.' }, { kind: 'pause', seconds: 0.8 },
    { kind: 'speech', text: 'À toi : Quel est le type de lipide le plus abondant dans notre alimentation ?' },
    { kind: 'beep' }, { kind: 'pause', seconds: 8 },
    { kind: 'speech', text: 'Réponse : Ce sont les triglycérides.' },
  ]);
});
it('lit la consigne si readPauseInstruction', () => { /* speech 'Mets sur pause et réponds.' avant beep */ });
it('quizMode false : consigne lue, aucun silence long', () => {});
it('pause 0,4 s entre paragraphes et 0,8 s avant un « ## » (titre lu sans les #)', () => {});
it('splitSentences ne dépasse jamais 300 caractères et ne coupe pas « ex. » ni « 1,5 »', () => {});
it('applique verbalize au texte parlé', () => { /* 'ATP' → 'A T P' */ });
```

- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Implémenter. Consigne = paragraphe correspondant à `/^(mets (sur|en) pause|pause|réfléchis)\b/i`. Phrase de question = paragraphe précédent commençant par `À toi` ou finissant par `?`. `detectQuiz` = au moins une consigne précédée d'une question.
- [ ] **Step 4:** → PASS. Commit `feat(quiz): segments et mode quiz mains libres`.

---

### Task 7: Import DOCX, PDF texte et OCR

**Files:**
- Create: `src/import/docx.ts`, `src/import/pdf.ts`, `src/import/ocr.ts`, `src/import/index.ts`, `tests/fixtures/makePdf.ts`, `tests/fixtures/makeDocx.ts`
- Test: `tests/import/docx.test.ts`, `tests/import/pdf.test.ts`, `tests/import/ocr.test.ts`

**Interfaces:**
- Consumes: `RawBlock`, `cleanDocument`.
- Produces:
  - `docxToBlocks(data: ArrayBuffer): Promise<RawBlock[]>`
  - `pdfToBlocks(data: ArrayBuffer): Promise<{ blocks: RawBlock[]; pageCount: number; needsOcr: boolean }>`
  - `ocrPdf(data: ArrayBuffer, onProgress: (page: number, total: number) => void): Promise<{ blocks: RawBlock[]; meanConfidence: number }>`
  - `ocrLinesToBlocks(lines: { text: string; confidence: number; bbox: { y0: number; y1: number } }[], page: number, pageHeight: number): RawBlock[]`
  - `importFile(file: File, onProgress?: (msg: string, ratio: number) => void, opts?: { forceOcr?: boolean }): Promise<ImportResult>` avec `type ImportResult = { title: string; chapters: DraftChapter[]; usedOcr: boolean; quizDetected: boolean }` ; lève `ImportError` (`code: 'unsupported-doc' | 'unsupported-type' | 'corrupt' | 'no-text'`, `message` en français).

- [ ] **Step 1: Fixtures** — `makePdf(pages: { lines: { text: string; size: number; y: number }[] }[]): Promise<Uint8Array>` (pdf-lib, police Helvetica) ; `makeDocx(blocks: { heading?: 1|2; text: string }[]): Promise<ArrayBuffer>` (lib `docx`).
- [ ] **Step 2: Tests**

```ts
it('docx : titres h1/h2 et paragraphes', async () => {
  const b = await docxToBlocks(await makeDocx([{ heading: 1, text: 'Épisode 1' }, { text: 'Bonjour !' }]));
  expect(b).toEqual([{ text: 'Épisode 1', kind: 'heading', level: 1 }, { text: 'Bonjour !', kind: 'paragraph' }]);
});
it('pdf : lignes avec page, fontSize, yRatio', async () => { /* 1 page, titre size 20 à y=750, corps size 12 → fontSize ≈ 20/12, yRatio ≈ 0.05 */ });
it('pdf sans texte → needsOcr', async () => { /* PDF d'une page vide → needsOcr true */ });
it('ocrLinesToBlocks : hauteur de bbox → fontSize, y → yRatio, confiance conservée', () => {});
it('importFile .doc → ImportError unsupported-doc', async () => {});
it('importFile fichier corrompu → ImportError corrupt', async () => {});
it('importFile titre = nom de fichier sans extension, « _ » → espace', async () => {
  // 'Chapitre_4_partie_2.pdf' → 'Chapitre 4 partie 2'
});
it.skipIf(!process.env.OCR_IT)('OCR réel sur une page rendue (intégration, opt-in)', async () => {});
```

- [ ] **Step 3:** → FAIL.
- [ ] **Step 4:** Implémenter.
  - `docx.ts` : `mammoth.convertToHtml({ arrayBuffer })`, parcourir le HTML avec `DOMParser` : `h1`/`h2`/`h3` → heading level, `p`/`li` → paragraph (li préfixé « • » retiré).
  - `pdf.ts` : `pdfjs-dist` (worker configuré via `?url` dans l'app ; build `legacy` dans Vitest). Regrouper `textContent.items` en lignes par `transform[5]` (tolérance 2 pt), `fontSize` = hauteur max de la ligne, `yRatio = 1 - y / viewport.height`. `needsOcr = totalChars / pageCount < 50`.
  - `ocr.ts` : rendre chaque page en canevas à 200 dpi (échelle 200/72) via pdf.js, `tesseract.js` `createWorker('fra')`, `recognize(canvas)` → `data.lines`. Un seul worker réutilisé pour toutes les pages, terminé à la fin.
  - `index.ts` : aiguillage par extension ; PDF → OCR si `needsOcr` ou `forceOcr` ; si l'OCR ne trouve aucun texte → `no-text` ; chapitres d'une note OCR avec confiance < 70 → flag `ocr-low-confidence`. `quizDetected = chapters.some(c => detectQuiz(c.text))`, et chapitres concernés reçoivent le flag `has-quiz`.
- [ ] **Step 5:** → PASS. Commit `feat(import): DOCX, PDF et OCR`.

---

### Task 8: Audio — PCM, silence, bip, MP3 en flux, worker Piper

**Files:**
- Create: `src/tts/audio.ts`, `src/tts/engine.ts`, `src/tts/tts.worker.ts`
- Test: `tests/tts/audio.test.ts`

**Interfaces:**
- Consumes: `Segment`.
- Produces:
  - `interface TtsEngine { sampleRate: number; synthesize(text: string): Promise<Float32Array> }`
  - `createWorkerEngine(voiceId: string, onDownload?: (ratio: number) => void): Promise<TtsEngine & { dispose(): void }>`
  - `listVoices(): { id: string; label: string }[]` (voix FR retenues, libellés français)
  - `wavToPcm(wav: ArrayBuffer): { pcm: Float32Array; sampleRate: number }`
  - `silence(seconds: number, sampleRate: number): Float32Array`, `beep(sampleRate: number): Float32Array`
  - `renderChapterToMp3(segments: Segment[], engine: TtsEngine, onProgress?: (ratio: number) => void): Promise<{ blob: Blob; durationSec: number }>`

- [ ] **Step 1: Tests**

```ts
it('silence : longueur exacte', () => expect(silence(8, 22050).length).toBe(176400));
it('beep : 0,25 s, amplitude max ≤ 0,3', () => {});
it('wavToPcm lit un WAV PCM 16 bits mono', () => {});
it('renderChapterToMp3 produit un MP3 (en-tête ID3 ou synchro 0xFFE) et la bonne durée', async () => {
  // engine factice : 1 s de sinus par phrase ; segments = speech, pause 2, beep, speech → durationSec ≈ 4.25 (±0.1)
});
it('renderChapterToMp3 encode en flux : l’encodeur reçoit chaque segment séparément, jamais le chapitre entier', async () => {
  // espionner encodeBuffer : nombre d’appels ≥ nombre de segments ; taille max d’un appel ≤ plus long segment
});
it('renderChapterToMp3 rapporte la progression jusqu’à 1', async () => {});
```

- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Implémenter. `Mp3Encoder(1, sampleRate, 48)` de `@breezystack/lamejs` ; conversion float → Int16 par segment ; blocs de 1152 échantillons ; `flush()` à la fin ; `Blob([...chunks], { type: 'audio/mpeg' })`. Worker : `import * as tts from '@diffusionstudio/vits-web'` ; messages `{ type: 'init', voiceId }` → `tts.download(voiceId, p => post progress)` ; `{ type: 'speak', id, text }` → `tts.predict({ text, voiceId })` → WAV Blob → `ArrayBuffer` renvoyé en transferable. `createWorkerEngine` enveloppe ces messages dans des promesses (corrélées par `id`).
- [ ] **Step 4:** → PASS. Vérification manuelle (`npm run dev`) : page de test temporaire non commitée qui génère « Bonjour, ceci est un essai. » et le joue. Commit `feat(tts): moteur Piper en worker et encodage MP3 en flux`.

---

### Task 9: Bibliothèque IndexedDB

**Files:**
- Create: `src/library/db.ts`
- Test: `tests/library/db.test.ts` (avec `fake-indexeddb/auto`)

**Interfaces:**
- Produces: `openLibrary(name = 'lecteur-notes'): Promise<Library>` ; `Library` :
  - Cours : `listCourses(): Promise<Course[]>` (trié par `order`), `saveCourse(c: Course)`, `deleteCourse(id)` (cascade notes)
  - Notes : `listNotes(courseId): Promise<Note[]>`, `getNote(id)`, `saveNote(n)`, `deleteNote(id)` (cascade chapitres, audio, progression + tombstones)
  - Chapitres : `listChapters(noteId): Promise<Chapter[]>` (trié par `index`), `saveChapter(ch)`, `deleteChapter(id)`
  - Audio : `putAudio(chapterId, blob)` (met `audioLocal = true`), `getAudio(chapterId): Promise<Blob | undefined>`, `deleteAudio(chapterId)` (met `audioLocal = false`)
  - `getProgress(noteId)`, `saveProgress(p)`, `getSettings(): Promise<Settings>` (défaut `DEFAULT_SETTINGS`), `saveSettings(s)`
  - `recoverInterrupted(): Promise<number>` — chapitres `generating` → `pending`, notes `generating` restent `generating` ; retourne le nombre corrigé
  - `exportSnapshot(): Promise<Snapshot>`, `applySnapshot(s: Snapshot): Promise<void>` (remplace les entités, préserve `audioLocal` local, supprime l'audio local des entités tombées)
  - `onChange(listener: (kind: 'library' | 'progress') => void): () => void`
- Tous les `save*` mettent `updatedAt = Date.now()` sauf `applySnapshot`.

- [ ] **Step 1: Tests** — CRUD aller-retour ; tri ; cascade `deleteNote` (chapitres, audio, progression disparus, tombstone `note` présente) ; `putAudio` bascule `audioLocal` ; `recoverInterrupted` remet 2 chapitres `generating` en `pending` et retourne 2 ; `exportSnapshot` n'a pas `audioLocal` ; `applySnapshot` préserve `audioLocal` ; `onChange` appelé avec `'progress'` après `saveProgress` et `'library'` après `saveNote`.
- [ ] **Step 2:** → FAIL. **Step 3:** Implémenter avec `idb` (stores `courses`, `notes` [index `courseId`], `chapters` [index `noteId`], `progress` [clé `noteId`], `audio` [clé `chapterId`], `meta` [settings], `tombstones`). Appeler `navigator.storage?.persist?.()` dans `openLibrary` (ignorer l'échec). **Step 4:** → PASS. Commit `feat(library): stockage IndexedDB`.

---

### Task 10: Générateur (file par note, reprise)

**Files:**
- Create: `src/tts/generator.ts`
- Test: `tests/tts/generator.test.ts`

**Interfaces:**
- Consumes: `Library`, `TtsEngine`, `buildSegments`, `renderChapterToMp3`.
- Produces: `class Generator { constructor(lib: Library, getEngine: (voiceId: string) => Promise<TtsEngine>); generateNote(noteId: string): Promise<void>; resumeAll(): Promise<void>; onProgress(l: (e: { noteId: string; chapterId: string; ratio: number; status: AudioStatus }) => void): () => void; readonly busy: boolean }`
- Comportement : `generateNote` supprime d'abord les chapitres `included: false` (réindexe), met la note `generating`, traite séquentiellement les chapitres non `ready`, sauvegarde audio + `durationSec` + `ready` après chacun, note `ready` à la fin. Erreur sur un chapitre → `error`, passe au suivant. Une seule note générée à la fois ; les autres attendent en file. `resumeAll` = `recoverInterrupted` puis `generateNote` pour chaque note `generating`.

- Espace plein : `QuotaExceededError` à `putAudio` → génération arrêtée, chapitre `error`, événement `{ status: 'error' }` avec `message: 'Espace insuffisant sur l’appareil'` (l'UI propose « Libérer l'audio des notes écoutées »).

- [ ] **Step 1: Tests** — moteur factice ; `QuotaExceededError` simulée → arrêt et message ; ordre des chapitres ; chapitre exclu supprimé et index recalculés (0..n-1) ; chapitre 2 qui échoue → `error` et chapitre 3 `ready` ; deux appels concurrents traités l'un après l'autre ; `resumeAll` après interruption simulée reprend au premier non prêt sans régénérer les prêts (compter les appels à `synthesize`).
- [ ] **Step 2:** → FAIL. **Step 3:** Implémenter. **Step 4:** → PASS. Commit `feat(tts): file de génération avec reprise`.

---

### Task 11: Lecteur et Media Session

**Files:**
- Create: `src/player/controller.ts`, `src/player/mediaSession.ts`
- Test: `tests/player/controller.test.ts`

**Interfaces:**
- Consumes: `Library`.
- Produces:
  - `type QueueItem = { noteId: string; chapterId: string; chapterIndex: number; title: string; noteTitle: string; courseName: string }`
  - `class PlayerController { constructor(audio: HTMLAudioElement, lib: Library, fetchRemoteAudio?: (ch: Chapter) => Promise<Blob | undefined>); loadNote(noteId: string): Promise<void>; loadCourse(courseId: string): Promise<void>; play(): Promise<void>; pause(): void; seekBy(sec: number): void; next(): Promise<void>; prev(): Promise<void>; goTo(queueIndex: number): Promise<void>; setRate(r: number): void; subscribe(l: (s: PlayerState) => void): () => void }`
  - `type PlayerState = { item?: QueueItem; queue: QueueItem[]; index: number; playing: boolean; position: number; duration: number; rate: number; waitingForAudio: boolean }`
  - `bindMediaSession(ctrl: PlayerController): void`
- Comportement : `loadNote` reprend à `Progress` (chapitre + position) ; URL audio via `URL.createObjectURL(await lib.getAudio(id))` (révoquée au changement) ; pas d'audio local mais `audioDriveId` → `fetchRemoteAudio` (branché sur `DriveApi.downloadAudio` en Task 13, stocké ensuite via `putAudio`) ; `playbackRate` et `preservesPitch = true` réappliqués après chaque changement de source ; `ended` → chapitre suivant ; chapitre pas encore `ready` → `waitingForAudio: true`, lecture arrêtée, reprend automatiquement quand le générateur signale `ready` (via `lib.onChange`) ; position sauvegardée toutes les 5 s pendant la lecture et à `pause` ; ≥ 95 % → `completedChapterIds`. `setRate` borne à [0.75, 2] arrondi au 0,25.

- [ ] **Step 1: Tests** (élément audio factice : `EventTarget` avec `currentTime`, `duration`, `playbackRate`, `play()`, `pause()`, `src`) — reprise à la position sauvegardée ; `seekBy(15)` / `seekBy(-15)` bornés à [0, duration] ; `ended` enchaîne ; `setRate(2.3)` → 2, `setRate(1.1)` → 1 ; vitesse conservée après changement de chapitre ; sauvegarde toutes les 5 s (faux temporisateurs) ; marque écouté à 95 % ; chapitre non prêt → `waitingForAudio` puis reprise quand il devient prêt ; `loadCourse` enchaîne les notes du cours dans l'ordre.
- [ ] **Step 2:** → FAIL. **Step 3:** Implémenter. `mediaSession.ts` : `navigator.mediaSession.metadata = new MediaMetadata({ title: item.title, artist: item.noteTitle, album: item.courseName, artwork: [icône 512] })` ; handlers `play`, `pause`, `seekbackward`/`seekforward` (15 s), `previoustrack`, `nexttrack`, `seekto` ; `setPositionState` à chaque `timeupdate`. **Step 4:** → PASS. Commit `feat(player): lecteur, vitesse, reprise, Media Session`.

---

### Task 12: Interface utilisateur

**Files:**
- Create: `src/ui/routes.ts`, `src/ui/screens/*.tsx`, `src/ui/components/*.tsx`, `src/ui/styles.css`, `src/ui/AppContext.tsx`
- Modify: `src/ui/App.tsx`, `src/main.tsx`
- Test: `tests/ui/preview.test.tsx`, `tests/ui/library.test.tsx`

**Interfaces:**
- Consumes: `importFile`, `Library`, `Generator`, `PlayerController`, `listVoices`, `estimateMinutes`.
- Produces: `AppContext` exposant `{ lib, generator, player }` ; routes par hash : `#/`, `#/course/:id`, `#/import`, `#/preview/:noteId`, `#/player`, `#/settings`.

Écrans (textes exacts) :
- **LibraryScreen** `Mes cours` : bloc « Reprendre » (dernière note écoutée), liste des cours avec nombre de notes, bouton « + Ajouter une note », lien « Réglages ».
- **CourseScreen** : notes avec « 3/7 chapitres écoutés » et état (« Brouillon », « Génération… 40 % », « Prête »), réordonnancement (boutons ↑/↓ — plus fiable que le glisser-déposer sur mobile), « Écouter tout le cours », renommer/supprimer le cours.
- **ImportScreen** : zone de dépôt + sélecteur (`accept=".pdf,.docx"`, multiple), choix/création du cours, progression par fichier (« Reconnaissance du texte : page 3/13 »), erreurs par fichier sans bloquer les autres ; après import → note `draft` enregistrée → `#/preview/:id`. Conseil affiché quand l'OCR a servi : « Astuce : pour un meilleur résultat, utilise “Enregistrer sous → PDF” plutôt que “Imprimer en PDF”. »
- **PreviewScreen** : lien « Le texte semble incorrect ? Réessayer avec la reconnaissance de texte » (PDF seulement, visible tant que le fichier importé est en mémoire dans la session ; relance `importFile(file, …, { forceOcr: true })` et remplace les chapitres du brouillon) ; par chapitre : case « Inclure », titre éditable, zone de texte éditable, « Fusionner avec le suivant », icônes de flags (⚠️ OCR faible, 🖼️ légendes, ❓ quiz) ; interrupteur « Mode quiz » (pré-coché si détecté) ; durée totale estimée (« ≈ 42 min ») ; bouton « Générer l'audio » ; avertissement « Garde l'app ouverte pendant la génération. »
- **PlayerScreen** + **MiniPlayer** (barre persistante en bas) : titre chapitre / note, barre de progression déplaçable, −15 / lecture-pause / +15, précédent/suivant, vitesse (0,75–2), liste des chapitres, message « Ce chapitre est en cours de génération… » si `waitingForAudio`.
- **SettingsScreen** : voix (+ « Écouter un échantillon »), vitesse par défaut, durée du silence quiz (3–15 s), « Lire la consigne de pause », « Télécharger automatiquement l'audio », section Google Drive (Task 13), espace utilisé (`navigator.storage.estimate()`), « Libérer l'audio des notes écoutées » (seulement si Drive connecté).
- **InstallHint** : iOS et non `standalone` → « Ajoute l'app à l'écran d'accueil (Partager → Sur l'écran d'accueil) pour l'écoute hors ligne et pour ne pas perdre tes notes. » (masquable, mémorisé).
- Style : mobile d'abord, cibles tactiles ≥ 44 px, thème clair/sombre via `prefers-color-scheme`.

- [ ] **Step 1: Tests** — Preview : décocher un chapitre puis « Générer l'audio » appelle `generator.generateNote` et le chapitre est `included: false` en base ; fusionner concatène les textes ; la durée estimée se met à jour. Library : affiche les cours et « Reprendre ».
- [ ] **Step 2:** → FAIL. **Step 3:** Implémenter. Au démarrage (`main.tsx`) : `openLibrary` → `generator.resumeAll()` → rendu. **Step 4:** → PASS ; `npm run build` OK. Commit `feat(ui): écrans bibliothèque, import, aperçu, lecteur, réglages`.

---

### Task 13: Synchro Google Drive

**Files:**
- Create: `src/sync/merge.ts`, `src/sync/driveClient.ts`, `src/sync/syncEngine.ts`
- Modify: `src/ui/screens/SettingsScreen.tsx`, `src/ui/App.tsx` (bandeau « Reconnecter Drive »)
- Test: `tests/sync/merge.test.ts`, `tests/sync/syncEngine.test.ts`

**Interfaces:**
- Consumes: `Library` (`exportSnapshot`, `applySnapshot`, `getAudio`, `putAudio`, `saveChapter`, `onChange`).
- Produces:
  - `mergeSnapshots(local: Snapshot, remote: Snapshot): Snapshot`
  - `interface DriveApi { ensureFolder(): Promise<string>; readLibrary(folderId: string): Promise<string | null>; writeLibrary(folderId: string, json: string): Promise<void>; uploadAudio(folderId: string, chapterId: string, blob: Blob): Promise<string>; downloadAudio(fileId: string): Promise<Blob>; deleteFile(fileId: string): Promise<void> }`
  - `createDriveClient(clientId: string): { connect(): Promise<void>; disconnect(): void; isConnected(): boolean; api: DriveApi }` — erreurs 401 → `DriveAuthError`
  - `class SyncEngine { constructor(lib: Library, api: DriveApi, getSettings: () => Promise<Settings>); syncNow(): Promise<SyncResult>; start(): void; stop(): void; onStatus(l: (s: SyncStatus) => void): () => void }`
  - `type SyncStatus = { state: 'idle' | 'syncing' | 'error' | 'auth-required'; lastSyncAt?: number; message?: string }`

- [ ] **Step 1: Tests merge** — entité absente d'un côté → présente ; même id → `updatedAt` max gagne ; tombstone avec `deletedAt ≥ updatedAt` → entité retirée, tombstone conservée ; tombstone plus ancienne qu'une modification → entité conservée ; progression la plus récente gagne ; `audioDriveId` défini d'un côté seulement → conservé (fusion de champ, pas d'écrasement par `undefined`).
- [ ] **Step 2: Tests syncEngine** (DriveApi factice en mémoire) — distant absent → écrit le local ; distant corrompu (`'{oops'`) → `state: 'error'`, `writeLibrary` **jamais** appelé ; audio local sans `audioDriveId` → téléversé puis `audioDriveId` enregistré ; chapitre distant `ready` avec `audioDriveId`, pas d'audio local, `autoDownloadAudio: true` → téléchargé ; `false` → non téléchargé ; tombstone de note → fichiers audio Drive supprimés ; `DriveAuthError` → `auth-required` ; modification locale → `syncNow` appelé une fois après 5 s malgré 3 changements (faux temporisateurs) ; changement `'progress'` → synchro au plus toutes les 30 s.
- [ ] **Step 3:** → FAIL. **Step 4:** Implémenter.
  - `driveClient.ts` : charger `https://accounts.google.com/gsi/client` ; `google.accounts.oauth2.initTokenClient({ client_id, scope: 'https://www.googleapis.com/auth/drive.file', callback })` ; jeton conservé en mémoire + `localStorage` avec expiration ; reconnexion silencieuse `requestAccessToken({ prompt: '' })`. Dossier : `files.list` avec `q = "name='Lecteur de notes' and mimeType='application/vnd.google-apps.folder' and trashed=false"`, sinon `files.create`. `library.json` : recherche par nom dans le dossier ; écriture `uploadType=multipart` (création) ou `PATCH .../upload/drive/v3/files/{id}?uploadType=media` (mise à jour). Audio : `chapter-<id>.mp3`, `audio/mpeg`. Téléchargement `?alt=media`.
  - `syncEngine.ts` : `syncNow` = lire distant → parser (erreur → arrêt) → `mergeSnapshots` → `applySnapshot` → téléversements/téléchargements/suppressions audio → `writeLibrary(exportSnapshot())`. Une seule synchro à la fois (les demandes pendant une synchro en déclenchent une seule après). `start()` : synchro immédiate, `window.online`, `lib.onChange`.
  - Brancher `fetchRemoteAudio` du `PlayerController` sur `api.downloadAudio` (+ `lib.putAudio`).
  - Réglages : « Connecter Google Drive » / « Déconnecter », état et heure de dernière synchro, « Synchroniser maintenant ». Si `VITE_GOOGLE_CLIENT_ID` absent : « La synchro Drive n'est pas configurée sur cette installation (voir README). »
- [ ] **Step 5:** → PASS. Commit `feat(sync): synchro Google Drive`.

---

### Task 14: PWA, hors ligne, README

**Files:**
- Modify: `vite.config.ts`, `index.html`
- Create: `public/icons/icon-192.png`, `public/icons/icon-512.png`, `public/icons/maskable-512.png`, `README.md` (remplace l'actuel)
- Test: `tests/pwa.test.ts`

- [ ] **Step 1: Test** — après `npm run build`, `dist/manifest.webmanifest` existe avec `name: 'Lecteur de notes'`, `short_name: 'Notes audio'`, `lang: 'fr'`, `display: 'standalone'`, `start_url: '/Lecteur-note-audio/'`, icônes 192 et 512 ; `dist/sw.js` existe.
- [ ] **Step 2:** → FAIL. **Step 3:** `vite-plugin-pwa` (`registerType: 'autoUpdate'`, précache de l'app ; cache runtime `CacheFirst` pour les fichiers `.wasm`/`.onnx`/`traineddata` des CDN). Icônes générées (casque + page, couleurs du thème). Mise à jour : toast « Nouvelle version disponible — Recharger ».
- [ ] **Step 4:** README en français : à quoi sert l'app ; installer sur iPhone (Safari → Partager → Sur l'écran d'accueil) et Android (Chrome → Installer) ; première utilisation (téléchargement de la voix ~60 Mo en Wi-Fi) ; conseil « Enregistrer sous PDF » ; **guide Google Cloud pas à pas** (créer un projet, activer l'API Google Drive, écran de consentement « Externe » + publier, créer un ID client OAuth « Application Web » avec origine `https://remibelisle08.github.io`, l'ajouter comme variable de dépôt `VITE_GOOGLE_CLIENT_ID`) ; **activer GitHub Pages** (Settings → Pages → Source : GitHub Actions) ; partager le lien ; limites connues (tableaux, formules, PDF schémas).
- [ ] **Step 5:** → PASS. Commit `feat(pwa): manifeste, service worker, README`.

---

### Task 15: Test bout en bout et vérification sur appareil

**Files:**
- Create: `playwright.config.ts`, `e2e/flow.spec.ts`

- [ ] **Step 1: Test E2E** (Chromium, `npm run build && npx vite preview`) : importer un DOCX généré (`makeDocx`, 2 épisodes courts dont un quiz) → aperçu montre 2 chapitres et ❓ → « Générer l'audio » avec moteur factice injecté via `window.__TEST_TTS__` (bip court par phrase, évite le téléchargement de 60 Mo en CI) → note « Prête » → lecture → `audio.currentTime` avance → recharger la page → « Reprendre » ramène au même chapitre.
- [ ] **Step 2:** `npx playwright test --trace off` → PASS. Ajouter l'étape au CI.
- [ ] **Step 3: Vérification réelle (manuelle, avec l'utilisateur)** — sur l'ordi : importer les 4 notes d'exemple (Chapitre 4) ; vérifier diapos progressives dédoublonnées, OCR des 2 PDF imprimés, quiz détecté dans le Word ; générer avec la vraie voix. Sur le téléphone : installer, synchro Drive, écoute écran verrouillé, contrôles auto/Bluetooth, silence quiz audible. Consigner les résultats dans le résumé final.
- [ ] **Step 4:** Commit `test: parcours bout en bout`.
