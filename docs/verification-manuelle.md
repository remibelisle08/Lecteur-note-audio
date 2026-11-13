# Vérification manuelle sur appareils

À faire une fois l'app publiée (ou lancée avec `npm run build && npx vite preview`). Coche chaque case et note ce que tu observes. Ne copie ici ni le contenu de tes cours ni aucune information personnelle.

Date : ____________  Ordinateur / navigateur : ____________  Téléphone / version : ____________

## Sur l'ordinateur

- [ ] **Import des 4 notes d'exemple** : les quatre fichiers (PDF et Word) s'importent sans erreur.
  Résultat : ____________
- [ ] **Diapos progressives** : dans l'aperçu, les diapos qui se construisent pas à pas ne sont pas répétées (texte dédoublonné).
  Résultat : ____________
- [ ] **OCR sur les 2 PDF imprimés** : le texte est reconnu (message de reconnaissance, avertissement si confiance faible) et lisible dans l'aperçu.
  Résultat : ____________
- [ ] **Quiz dans le Word** : le chapitre concerné affiche ❓ ; le mode quiz ajoute bip puis silence après la question.
  Résultat : ____________
- [ ] **Voix réelle** : « Générer l'audio » télécharge la voix une fois, puis génère toutes les notes ; la durée de génération reste raisonnable.
  Résultat : ____________
- [ ] **Qualité d'écoute** : prononciation, rythme, pauses entre paragraphes et avant les titres ; chiffres et abréviations bien lus.
  Résultat : ____________

## Sur le téléphone (iPhone)

- [ ] **Installation** : « Ajouter à l'écran d'accueil » depuis Safari ; l'app s'ouvre en plein écran et fonctionne hors ligne.
  Résultat : ____________
- [ ] **Lecture écran verrouillé** : l'audio continue, titre du chapitre affiché sur l'écran de verrouillage, pause/reprise et ±15 s fonctionnent.
  Résultat : ____________
- [ ] **Enchaînement écran verrouillé, entre chapitres** : lance une note de plusieurs chapitres, verrouille le téléphone ; à la fin d'un chapitre, le suivant démarre seul et son titre s'affiche sur l'écran de verrouillage.
  Résultat : ____________
- [ ] **Enchaînement écran verrouillé, entre notes** : dans un cours de plusieurs notes, « Écouter tout le cours », verrouille le téléphone ; à la fin de la dernière partie d'une note, la note suivante démarre seule (les brouillons sont ignorés).
  Résultat : ____________
- [ ] **Génération d'un chapitre complet avec la vraie voix sur un téléphone milieu de gamme** : génère un long chapitre sur le téléphone lui-même ; surveille le ralentissement, la chauffe ou un plantage/rechargement de l'app, et note la durée.
  Résultat : ____________
- [ ] **Voiture / Bluetooth** : boutons précédent/suivant, lecture/pause depuis l'autoradio ou les écouteurs.
  Résultat : ____________
- [ ] **Silence du quiz audible** : le bip est net, le silence dure bien la durée réglée (3 à 15 s) avant la réponse.
  Résultat : ____________
- [ ] **Synchro Drive ordinateur → téléphone** : connexion à Google Drive sur les deux appareils ; une note générée sur l'ordinateur apparaît sur le téléphone, l'audio se lit, la position d'écoute se retrouve.
  Résultat : ____________
- [ ] **Bandeau « Reconnecter Drive » après ~1 h** : laisse l'app ouverte plus d'une heure avec Drive connecté (le jeton Google expire) ; si le renouvellement silencieux échoue, le bandeau « Synchro Drive en pause » apparaît, « Reconnecter Drive » relance la synchro, et la lecture n'est jamais interrompue.
  Résultat : ____________
- [ ] **Données mobiles pendant une heure d'écoute avec Drive** : en 4G/5G, Wi-Fi coupé, note la consommation de l'app (Réglages → Données cellulaires) avant et après une heure d'écoute écran verrouillé ; elle doit rester faible (quelques Mo hors téléchargement d'audio).
  Résultat : ____________

## Bilan

Problèmes bloquants : ____________

Améliorations souhaitées : ____________
