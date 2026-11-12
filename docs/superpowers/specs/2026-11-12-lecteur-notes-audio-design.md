# Lecteur de notes audio — Design (v1)

Date : 2026-11-12
Statut : en revue

## 1. Intention

**Objectif.** Écouter ses notes de cours (PDF, Word) comme des balados, surtout en déplacement (auto, transport), sur téléphone, écran verrouillé.

**Exigences exprimées par l'utilisateur**
- 100 % gratuit (aucun service payant, aucune carte de crédit requise).
- Accessible hors de Claude, via un lien partageable à d'autres personnes.
- Ajouter de nouvelles notes en tout temps.
- Déposer depuis l'ordinateur, écouter sur le téléphone.
- Lecture écran verrouillé.
- Accent québécois : non requis.
- Synchro Google Drive (principal) **et** mode 100 % local sans compte (secondaire).

**Hypothèses**
- Usage personnel ou petit cercle ; pas un produit commercial.
- Notes en français, majoritairement textuelles (peu de formules/tableaux).

**Critères de succès**
1. Une note PDF ou Word déposée sur l'ordi devient écoutable sur le téléphone sans manipulation manuelle (Drive activé).
2. L'audio continue écran verrouillé, avec contrôles sur l'écran de verrouillage / auto / écouteurs.
3. L'écoute fonctionne hors ligne une fois l'audio téléchargé.
4. Aucun coût, aucune carte de crédit.
5. Une autre personne peut utiliser l'app avec sa propre bibliothèque, à partir du seul lien.

## 2. Décisions clés et raisons

| Décision | Choix | Raison |
|---|---|---|
| Forme | PWA (app web installable) | Pas d'App Store, un seul code ordi + téléphone, lien partageable |
| Hébergement | GitHub Pages (dépôt public, code seulement) | Gratuit ; les notes ne sont jamais dans le dépôt |
| Voix | Piper (TTS neuronal open source) exécuté dans le navigateur via `@diffusionstudio/vits-web` | Gratuit, illimité, sans compte ; voix FR (siwis, upmc, tom…) |
| Lecture | **Fichiers audio générés** (pas de lecture TTS en direct) | La synthèse vocale du navigateur s'arrête écran verrouillé ; un fichier audio, non |
| Format audio | MP3 mono ~48 kb/s (encodage dans le navigateur, `@breezystack/lamejs`) | Lu partout (iOS inclus) ; ~20 Mo/h au lieu de ~160 Mo/h en WAV |
| Stockage local | IndexedDB (`idb`) + `navigator.storage.persist()` | Mode C sans compte ; hors ligne |
| Synchro | Google Drive REST v3, portée `drive.file` | Gratuit (15 Go), chaque utilisateur a son Drive ; portée non sensible (accès limité aux fichiers créés par l'app) |
| Stack | Vite + React + TypeScript, Vitest, `vite-plugin-pwa` | Répandu, lisible, outillage PWA mature |
| Extraction | `pdfjs-dist` (PDF), `mammoth` (.docx) | Standards, maintenus, gratuits |

**Rejetés :** voix payantes (OpenAI, ElevenLabs), Google Cloud TTS (carte de crédit), voix Edge (usage non officiel, fragile), Supabase (pause après 7 jours d'inactivité, 1 Go), clonage de voix (trop lourd), Kokoro (support français limité dans `kokoro-js`).

## 3. Architecture

Cinq modules à responsabilité unique, testables indépendamment :

```
src/
  import/      PDF/DOCX → blocs de texte bruts avec métadonnées (taille de police, style, page)
  cleanup/     blocs bruts → texte propre découpé en chapitres (fonctions pures)
  tts/         chapitre → MP3 (Web Worker : Piper + encodage MP3)
  library/     modèle de données + persistance IndexedDB
  sync/        miroir de la bibliothèque ↔ Google Drive (optionnel)
  player/      lecture, file d'attente, Media Session, mémoire de position
  ui/          écrans React
```

### 3.1 Import
- **PDF** (`pdfjs-dist`) : extrait chaque élément de texte avec page, position verticale, taille de police. Si le texte total < ~50 caractères par page en moyenne → erreur « PDF numérisé ».
- **DOCX** (`mammoth`) : conversion en HTML sémantique ; `h1`–`h3` deviennent des candidats de titres.
- `.doc` (ancien format) non supporté : message demandant de réenregistrer en `.docx`.
- Sortie commune : `RawBlock[]` = `{ text, kind: 'heading'|'paragraph', level?, page?, fontSize?, y? }`.

### 3.2 Nettoyage + chapitres (fonctions pures)
- Retirer les en-têtes et pieds de page : lignes répétées (texte normalisé, chiffres masqués) sur ≥ 50 % des pages, situées en haut ou en bas de page.
- Retirer les numéros de page isolés (`12`, `- 12 -`, `Page 12 de 40`).
- Recoller les mots coupés en fin de ligne (`ap-\nprentissage` → `apprentissage`) et les lignes d'un même paragraphe.
- Normaliser espaces, puces, guillemets ; remplacer URL longues par « lien ».
- **Chapitres** : DOCX → titres `h1`/`h2`. PDF → lignes dont la taille de police est nettement supérieure au corps du texte (≥ 1,2× la médiane) et courtes. Aucun titre détecté → découpage en sections d'environ 10 minutes aux limites de paragraphes.
- Chaque chapitre : `{ title, text, included: true }`.

### 3.3 Voix (TTS)
- Exécuté dans un **Web Worker** pour ne pas figer l'interface.
- Voix téléchargée une fois (~60 Mo) puis mise en cache (Cache Storage / OPFS par la librairie).
- Le texte d'un chapitre est découpé en phrases ; chaque lot est synthétisé puis concaténé et encodé en MP3.
- Un chapitre prêt est immédiatement écoutable. Progression rapportée par chapitre.
- Reprise : l'état `pending|generating|ready|error` de chaque chapitre est persisté ; au redémarrage, on reprend au premier chapitre non prêt.
- Réglage : choix de la voix FR (défaut : `fr_FR-siwis-medium`) avec bouton « écouter un échantillon ».

### 3.4 Bibliothèque (modèle de données)
```ts
Course   { id, name, order, updatedAt }
Note     { id, courseId, title, sourceFileName, order, createdAt, updatedAt,
           chapterIds: string[], status: 'draft'|'generating'|'ready' }
Chapter  { id, noteId, index, title, text, durationSec?,
           audioStatus: 'pending'|'generating'|'ready'|'error',
           audioLocal: boolean, audioDriveId?: string }
Progress { noteId, chapterIndex, positionSec, completedChapterIds: string[], updatedAt }
AudioBlob { chapterId, blob }   // magasin séparé
```
- IDs : UUID. `updatedAt` sert à la résolution de conflits.
- Le fichier source original n'est pas conservé (seulement le texte nettoyé).

### 3.5 Synchro Google Drive (optionnelle)
- Connexion via Google Identity Services (jeton OAuth côté client, portée `https://www.googleapis.com/auth/drive.file`).
- Dossier visible `Lecteur de notes/` dans le Drive : `library.json` (cours, notes, chapitres sans audio, progression) + un MP3 par chapitre.
- Déclencheurs : au lancement, au retour en ligne, après chaque modification (avec délai d'agrégation ~5 s), et périodiquement pendant l'écoute pour la position (~30 s).
- Fusion : par entité, `updatedAt` le plus récent gagne. Progression : la plus récente gagne. Suppressions : marqueur `deletedAt` (pierre tombale) conservé dans `library.json`.
- Audio sur l'autre appareil : réglage « Télécharger automatiquement l'audio » (activé par défaut). Le type de réseau (Wi-Fi vs cellulaire) n'est pas détectable de façon fiable sur iPhone, donc pas de règle automatique « Wi-Fi seulement ». Si désactivé : bouton « Télécharger pour hors ligne » par note, et lecture en continu depuis Drive au moment de jouer.
- Jeton expiré → bandeau « Reconnecter Drive » ; l'écoute locale n'est jamais bloquée.

### 3.6 Lecteur
- Un élément `<audio>` unique ; file d'attente = chapitres de la note (ou toutes les notes du cours en mode « Écouter tout le cours »).
- Contrôles : lecture/pause, ±15 s, chapitre précédent/suivant, vitesse 0,75× à 2× (pas de 0,25), liste des chapitres.
- **Media Session API** : titre du chapitre, nom de la note/cours, actions play/pause/seekbackward/seekforward/previoustrack/nexttrack.
- Position sauvegardée toutes les 5 s et à la pause ; reprise à la seconde près.
- Un chapitre est marqué écouté à ≥ 95 %.

## 4. Parcours d'utilisation

1. **Ajouter** : bouton « + » ou glisser-déposer (`.pdf`, `.docx`, multiples). Choix/création du cours, titre proposé depuis le nom de fichier.
2. **Aperçu** : texte nettoyé par chapitre ; cocher/décocher, renommer, fusionner avec le suivant, éditer le texte ; durée estimée (~150 mots/min à 1×).
3. **Générer** : progression par chapitre ; navigation libre ; avertissement « garder l'app ouverte ».
4. **Bibliothèque** : « Reprendre » en haut ; cours → notes avec progression (« 3/7 chapitres ») ; réordonnancement des notes par glisser-déposer ; « Écouter tout le cours ».
5. **Lecteur** : voir 3.6.
6. **Réglages** : voix, vitesse par défaut, connexion Drive, téléchargement auto, espace utilisé, retirer l'audio local des notes écoutées.

## 5. Gestion des erreurs

| Situation | Comportement |
|---|---|
| PDF numérisé (pas de texte) | Message clair, note non créée |
| Fichier corrompu / non supporté | Message par fichier, le reste du lot continue |
| Génération interrompue | Reprise au premier chapitre non prêt |
| Espace plein | Avertissement + proposition de libérer l'audio local des notes écoutées (si Drive) |
| Hors ligne | Lecture de ce qui est local ; synchro en file d'attente |
| Conflit entre appareils | `updatedAt` le plus récent gagne |
| Jeton Google expiré | Bandeau « Reconnecter Drive », lecture non bloquée |
| iPhone, site non installé | Rappel au 1er lancement : ajouter à l'écran d'accueil (évite l'effacement des données après 7 jours) |

## 6. Tests

- **Unitaires (Vitest)** : module `cleanup` sur des jeux d'essai (en-têtes répétés, numéros de page, mots coupés, titres PDF par taille de police, DOCX à titres, document sans titre) ; fusion de synchro (conflits, pierres tombales) ; logique de progression/reprise.
- **Intégration** : import réel d'un petit PDF et d'un petit DOCX de test (fixtures dans `tests/fixtures/`).
- **Bout en bout (Playwright, Chromium)** : ajout d'une note → aperçu → génération d'un court chapitre → lecture.
- **Manuels sur appareil réel** (avec l'utilisateur) : écran verrouillé iOS/Android, contrôles auto/Bluetooth, synchro ordi → téléphone, installation PWA.
- Calibration du nettoyage avec 2–3 vraies notes de l'utilisateur si fournies.

## 7. Déploiement et partage

- GitHub Actions : build + tests à chaque push ; déploiement GitHub Pages depuis `main`.
- Dépôt public requis (plan GitHub gratuit). Aucune donnée utilisateur dans le dépôt.
- `README.md` en français : utilisation, installation sur iPhone/Android, guide pas à pas de création du projet Google Cloud (ID client OAuth, origine autorisée = URL GitHub Pages), et comment partager.
- L'ID client OAuth est public par nature (application côté client) ; il est placé dans la configuration de build.

## 8. Hors portée v1 — prévu en V2

- **Texte synchronisé** : surlignage de la phrase en cours de lecture (façon Speechify).
- **Signets** : marquer un passage pour le réécouter.
- **Minuterie de sommeil**.
- OCR des PDF numérisés (Tesseract.js, gratuit).
- Import direct depuis un dossier Google Drive.

Hors portée (exigerait une IA payante) : résumés, quiz, format balado à deux voix.

## 9. Risques connus

- **Vitesse de génération** : quelques minutes par note sur ordi, nettement plus sur téléphone ancien. Mitigation : génération sur l'ordi recommandée ; chapitres écoutables au fil de l'eau.
- **Qualité du nettoyage PDF** : variable selon la mise en page. Mitigation : étape d'aperçu/édition.
- **Tableaux et formules** : lus maladroitement. Mitigation : exclusion à l'aperçu.
- **Écran « app non vérifiée » Google** : peu probable avec `drive.file` (portée non sensible), à confirmer à la configuration.
- **Dépendance Piper web** : librairie communautaire ; isolée derrière l'interface du module `tts/` pour pouvoir la remplacer.
