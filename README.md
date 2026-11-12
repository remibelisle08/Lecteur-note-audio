# Lecteur de notes

Transforme tes notes de cours (PDF ou Word) en « balados » audio, un MP3 par chapitre, que tu écoutes dans l'app, même hors ligne. Tout se passe dans ton navigateur : gratuit, sans compte, sans serveur.

**Adresse de l'app :** https://remibelisle08.github.io/Lecteur-note-audio/

## À quoi ça sert

- Tu importes un fichier `.pdf` ou `.docx` (les `.doc` doivent d'abord être réenregistrés en `.docx`).
- L'app nettoie le texte, le découpe en chapitres et lit chaque chapitre avec une voix française de bonne qualité.
- Tu écoutes comme un balado : vitesse de 0,75× à 2×, sauts de 15 secondes, reprise là où tu t'es arrêté·e, écran verrouillé.
- Un mode quiz laisse un silence (précédé d'un bip) pour répondre à voix haute.

> **Conseil :** si ton document est complexe (mise en page chargée, colonnes), ouvre-le dans Word ou ton lecteur PDF et choisis **Enregistrer sous… PDF** avant de l'importer : le texte en sort généralement plus propre.

## Installer l'app

**iPhone / iPad (Safari)** : ouvre l'adresse ci-dessus → bouton **Partager** → **Sur l'écran d'accueil**.
Important : sans cette installation, iOS peut effacer les données du site après quelques jours d'inactivité (tes chapitres audio compris).

**Android (Chrome)** : ouvre l'adresse → menu ⋮ → **Installer l'application** (ou **Ajouter à l'écran d'accueil**).

**Ordinateur (Chrome ou Edge)** : icône d'installation dans la barre d'adresse.

## Première utilisation

1. Connecte-toi en **Wi-Fi** : au premier lancement, l'app télécharge la voix (environ **60 Mo**). C'est fait une seule fois ; elle reste ensuite sur ton appareil.
2. Importe un fichier, vérifie l'aperçu des chapitres, puis lance la génération.
3. La génération demande un peu de temps ; **garde l'app ouverte** jusqu'à la fin.
4. Après ça, l'app fonctionne **hors ligne** (lecture, bibliothèque, génération avec les fichiers déjà téléchargés).

Quand une nouvelle version est publiée, un bandeau « Nouvelle version disponible — Recharger » apparaît. La nouvelle version s'applique quand tu touches **Recharger** dans ce bandeau, ou après avoir complètement fermé l'app puis rouvert.

## Activer GitHub Pages (une seule fois)

Pour la personne qui gère le dépôt :

1. **Fusionne le code dans `main`.** Le code de l'app se trouve pour l'instant sur la branche de travail créée par Claude (son nom commence par `claude/`), et le site n'est publié que depuis `main`. Sur GitHub : onglet **Pull requests** → **New pull request** → **base : `main`** ← **compare : la branche qui commence par `claude/`** → **Create pull request** → **Merge pull request**.
2. Ouvre le dépôt → **Settings** → **Pages**.
3. Dans **Source**, choisis **GitHub Actions**.
4. Le déploiement se fait automatiquement à chaque *push* sur la branche `main` (onglet **Actions** pour suivre l'avancement). L'app est ensuite disponible à l'adresse indiquée plus haut.

## Synchroniser avec Google Drive (optionnel)

La synchro copie ta bibliothèque et tes MP3 dans un dossier **Lecteur de notes** de ton propre Google Drive, pour retrouver tes cours sur un autre appareil. C'est facultatif ; sans configuration, la section Drive est simplement masquée dans l'app.

Il faut créer un identifiant gratuit (une fois, environ 15 minutes) :

1. Va sur https://console.cloud.google.com et connecte-toi avec ton compte Google.
2. **Créer un projet** (menu du haut → **Nouveau projet**), par exemple « Lecteur de notes ».
3. Menu **API et services** → **Bibliothèque** → cherche **Google Drive API** → **Activer**.
4. **API et services** → **Écran de consentement OAuth** (ou « Google Auth Platform ») :
   - Type d'utilisateur : **Externe**.
   - Renseigne le nom de l'app et ton adresse de contact (visible seulement dans l'écran d'autorisation).
   - Ajoute la portée `.../auth/drive.file`. Cette portée donne accès **uniquement aux fichiers créés par l'app** : elle ne peut pas lire le reste de ton Drive.
   - **Publie l'application** (bouton **Publier l'application** / « En production »), sinon seuls les utilisateurs de test déclarés peuvent se connecter.
   - Il se peut que Google affiche « Cette application n'a pas été validée ». C'est normal pour une app personnelle : clique sur **Paramètres avancés** puis sur **Accéder à Lecteur de notes (non sécurisé)**.
5. **API et services** → **Identifiants** → **Créer des identifiants** → **ID client OAuth** :
   - Type d'application : **Application Web**.
   - **Origines JavaScript autorisées** : `https://remibelisle08.github.io` (sans barre oblique finale, sans chemin).
   - Copie l'**ID client** obtenu (il se termine par `.apps.googleusercontent.com`). Ce n'est pas un secret.
6. Sur GitHub : dépôt → **Settings** → **Secrets and variables** → **Actions** → onglet **Variables** → **New repository variable** :
   - Nom : `VITE_GOOGLE_CLIENT_ID`
   - Valeur : l'ID client copié.
7. Relance le déploiement, **à partir d'une exécution sur `main`** (le code doit d'abord avoir été fusionné dans `main`, voir « Activer GitHub Pages ») : onglet **Actions** → choisis la dernière exécution de **CI** dont la branche est `main` → **Re-run all jobs**. Une exécution d'une autre branche ne publie rien.
8. Dans l'app, ouvre **Réglages** → **Connecter Google Drive**.

## Partager l'app

Envoie simplement le lien https://remibelisle08.github.io/Lecteur-note-audio/. Chaque personne a **sa propre bibliothèque**, stockée sur son appareil. Si elle active la synchro Drive, c'est dans **son** Drive à elle, jamais dans le tien. Tes fichiers de cours ne sont jamais envoyés nulle part.

## Limites connues

- Les **tableaux** et les **formules** sont lus de façon approximative (souvent cellule par cellule ou symbole par symbole).
- Les **schémas** et images dans un PDF ne sont pas lus ; dans un PDF numérisé, la reconnaissance de texte (OCR) peut faire des erreurs, et l'app avertit quand sa confiance est faible.
- La voix demande un navigateur récent : **Safari 16.4 / iOS 16.4 ou plus**, ou une version récente de Chrome, Edge ou Firefox. Sinon, l'app affiche « Ton navigateur est trop ancien… ».
- Le premier téléchargement de la voix pèse environ **60 Mo** : fais-le en Wi-Fi.
- La **génération doit rester ouverte** : ne ferme pas l'app et ne verrouille pas l'écran pendant qu'elle travaille (elle reprend si elle est interrompue).
- L'**OCR** (PDF numérisés) nécessite une connexion la première fois ; ensuite, ses fichiers restent en cache.
- **iPhone** : ajoute l'app à l'écran d'accueil pour éviter la perte de données par iOS.
- La vraie voix n'a pas pu être testée dans l'environnement de développement : le premier essai réel se fera sur ton appareil. Si quelque chose cloche, note le message d'erreur affiché.

## Pour les développeurs

Stack : Vite 6, React 18, TypeScript. Voix Piper (WASM) dans un Web Worker, MP3 via lamejs, PDF via pdf.js, OCR via tesseract.js.

```bash
npm ci          # installer les dépendances
npm run dev     # serveur local
npm test        # tests (le test PWA construit l'app dans un dossier temporaire)
npm run build   # vérification TypeScript + build de production dans dist/
```

Test d'OCR réel (lent, télécharge les données de langue) : `OCR_IT=1 npm test`.

Les icônes se régénèrent avec `python3 scripts/make-icons.py` (Pillow requis).
