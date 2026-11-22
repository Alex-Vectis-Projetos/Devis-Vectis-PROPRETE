# Informations juridiques en attente — 27 marqueurs « À COMPLÉTER »

État : branche `feat/legal-2-pages` (PR #31, brouillon). Contrôle : `node server/test/legal-ready.check.js` (**échoue volontairement** tant qu'il reste un marqueur ; hors CI).
Classes : **O** obligatoire · **C** applicable sous conditions · **R** recommandé · **N** non applicable (par défaut).
Rien n'est rempli par supposition. Les textes de loi n'ont pas pu être relus en entier (Légifrance inaccessible depuis la session de travail) : les citations sont à valider par un conseil.
**Les pages ne déclarent aucune conformité juridique complète** tant que ces points sont ouverts.

## Mentions légales (11)

| # | Marqueur | Classe | Motif | Pour fermer |
|---|---|---|---|---|
| M1 | Date de publication | R | Non exigée par la loi ; traçabilité. | Date du jour de mise en ligne. |
| M2 | Téléphone public de VECTIS | O | L'identification de l'éditeur personne morale comprend un moyen de contact téléphonique (art. 1-1 loi 2004-575, ancien art. 6 III). Le numéro +33 7 80 25 11 28 n'apparaît que dans des instructions, pas dans le Kbis, l'attestation INPI ou les statuts. | Confirmation écrite de VECTIS du numéro à publier. |
| M3 | Raison sociale de l'entité Hostinger | O | Identité de l'hébergeur (même article). Seul « Hostinger » est connu. | Facture, contrat ou conditions de service Hostinger indiquant l'entité contractante. |
| M4 | Adresse de l'hébergeur | O | Idem. | Même document. |
| M5 | Téléphone de l'hébergeur | O | Idem. | Même document. |
| M6 | Justificatif du titulaire du domaine | R | Non exigé dans les mentions ; titulaire indiqué : VECTIS. | Fiche du registrar ou extrait WHOIS/AFNIC au nom de VECTIS. |
| M7 | Titularité patrimoniale du site (auteur → VECTIS) ; attribution de la conception à Alex Da Silva De Souza | C | Seulement si la rubrique propriété intellectuelle revendique des droits ; l'attribution repose sur les instructions du client, aucun document ne la prouve. | Contrat de cession (ou déclaration d'auteur) signé. |
| M8 | Origine et droits des images de la galerie | O | La vérification des droits (auteur, droit à l'image) est préalable à toute diffusion ; aucun document fourni. | Contrats/licences, ou retrait des images sans justificatif. |
| M9 | Dépôt de marque INPI | N | Sans objet tant que VECTIS ne revendique pas de marque. | Supprimer la ligne, ou fournir le certificat de dépôt. |
| M10 | Médiateur de la consommation | O | VECTIS s'adresse aussi à des particuliers (confirmé le 22/11/2026) : l'obligation d'accès à un médiateur (art. L612-1 Code de la consommation) s'applique. **Situation actuelle : aucun médiateur désigné ou adhéré (aucun document fourni) ; la médiation n'est donc pas opérationnelle.** Les pages ne nomment aucun médiateur, n'affirment aucune adhésion et ne déclarent aucune conformité. | Adhésion ou désignation d'un médiateur par VECTIS (justificatif) ; puis publier ses coordonnées et mettre à jour la section 8 des mentions. |
| M11 | Juridiction compétente | R | Clause facultative, inopposable aux consommateurs. | Validation par un conseil. |

## Politique de confidentialité (14)

| # | Marqueur | Classe | Motif | Pour fermer |
|---|---|---|---|---|
| P1 | Date de publication | R | Voir M1. | Date de mise en ligne. |
| P2 | Absence de DPO | C | Désignation obligatoire seulement dans les cas de l'art. 37 RGPD (probablement non applicable). | Confirmation de VECTIS. |
| P3 | Transferts Google (Gmail) hors UE | O | Information obligatoire (art. 13.1.f RGPD). | Conditions/clauses Google applicables au compte de VECTIS. |
| P4 | Entité Hostinger, lieu d'hébergement, garanties | O | Identification des destinataires et des transferts (art. 13.1.e-f). | Contrat/DPA Hostinger. |
| P5 | Autres prestataires de stockage ou de sauvegarde | C | Seulement s'il en existe. | Inventaire des prestataires par VECTIS. |
| P6 | Durée de conservation des devis et photos | O | Art. 13.2.a et 5.1.e RGPD. Prouvé dans le code (`deploy/UPLOADS-AUDIT.md` §6) : aucune suppression, ni des demandes, ni des fichiers `uploads/quotes/`, envoyées ou abandonnées. | Décision écrite de VECTIS sur la durée ; une purge automatique ou manuelle documentée serait ensuite à développer et à autoriser séparément. |
| P7 | Durée de conservation des e-mails Gmail | O | Les demandes et leurs photos sont dans la boîte Gmail de VECTIS (prouvé : envoi par l'API Gmail) ; aucune règle de suppression connue. | Décision de VECTIS ; réglage éventuel dans Gmail (hors application). |
| P8 | Durée de conservation des sauvegardes | O | Les sauvegardes manuelles contiennent la base **et** le dossier des photos (`deploy/BACKUP-SQLITE.md`) ; conditionne aussi la mesure d'audience (secret du jour dans la base). Dossier `/root/backups-devis-vectis` : durée inconnue. | Décision de VECTIS sur la durée et le lieu de conservation des sauvegardes. |
| P9 | Rotation du journal d'accès Nginx (autres routes) | O | Contient l'adresse IP. | Lecture de la configuration de rotation réelle (autorisation distincte). |
| P10 | Rotation du journal d'erreurs Nginx et des logs Docker | O | Peuvent contenir l'IP ; les logs de l'application enregistrent l'IP de toutes les requêtes sauf `/api/stats/e` (`deploy/UPLOADS-AUDIT.md` §5). | Idem. |
| P11 | Délai de réponse et justificatif d'identité | R | Le délai légal est d'un mois (art. 12.3 RGPD), reprenable tel quel. | Choix de VECTIS. |
| P12 | Décision juridique sur la mesure (intérêt légitime ou consentement) | O | Dispense CNIL non démontrée : `deploy/PRIVACY-CNIL-ASSESSMENT.md`. | Décision écrite voie A ou B avec avis d'un conseil. |
| P13 | État de la mesure à la date de publication | O | Exactitude de l'information. | « non activée » ou « activée depuis … » au moment de la publication. |
| P14 | Durée des sauvegardes (rubrique audience) | O | Même décision que P8. | Idem P8. |

## Gestion des cookies (2)

| # | Marqueur | Classe | Motif | Pour fermer |
|---|---|---|---|---|
| C1 | Date de publication | R | Voir M1. | Date de mise en ligne. |
| C2 | Vérification des en-têtes `Set-Cookie` en production | O | La page affirme l'absence de cookie visiteur ; à vérifier avant publication. | `curl -sI https://devis.mrprop.fr/` (lecture seule) depuis un poste autorisé. |

## Synthèse
- **Obligatoires (17)** : M2, M3, M4, M5, M8, M10, P3, P4, P6, P7, P8, P9, P10, P12, P13, P14, C2.
- **Conditionnelles (3)** : M7, P2, P5.
- **Recommandées (6)** : M1, M6, M11, P1, P11, C1.
- **Non applicable par défaut (1)** : M9.
- Total 27.

## Points hors marqueurs (à décider, non inscrits dans les pages)
- Particuliers (B2C) : l'activité pour des consommateurs implique d'autres obligations (information précontractuelle, conditions générales de vente, droit de rétractation pour les contrats à distance) non traitées par ces pages ; à valider par un conseil. Le texte historique de la section « À propos » du site (`index.html`) parle encore de « professionnels » seulement : à harmoniser sur décision de VECTIS.
- Identité de la Présidente : le Kbis écrit « DE FATIMA DA SILVA Lucia » ; les statuts « Lúcia De Fátima Da Silva ». Les pages suivent le Kbis.
- SIRET (…00013) et TVA (FR13 107463358) : fournis par VECTIS, absents du Kbis et de l'INPI ; à confirmer sur l'avis de situation INSEE / justificatif TVA.
- Activité exercée au Kbis : seule la consultation (APE 7022Z) y figure ; le nettoyage est dans l'objet social. À confirmer avec l'expert-comptable.

## Constats issus de l'audit des téléversements (`deploy/UPLOADS-AUDIT.md`)
- **Prouvé :** photographies reçues par `POST /api/quotes/:id/photos`, stockées dans `/var/lib/devis-vectis/uploads/quotes` (volume `devis_vectis_data`), transmises à Gmail (API Google) en pièces jointes ; aucun autre service externe dans le code ; aucune route publique ni d'administration ne les sert.
- **Aucune purge** des demandes, photos et fichiers ; métadonnées d'image non supprimées côté serveur ; logs applicatifs avec IP : les trois sont décrits dans la politique, durées à décider (P6, P8, P10).
- **Non prouvé :** configuration Nginx réelle du VPS (racine, alias) et droits du volume sur l'hôte ; à confirmer en lecture seule avant publication.
- **Page institutionnelle :** les textes par défaut de `index.html` (puce du bandeau et section « À propos ») parlent maintenant de particuliers et de professionnels ; le contenu publié depuis l'administration peut les remplacer en production : à vérifier. Le champ « Nom / Société » du formulaire (placeholder « Ex. : Entreprise Dupont ») et le titre de page « VECTIS Portail V4 » n'ont pas été modifiés (hors périmètre documentaire).
