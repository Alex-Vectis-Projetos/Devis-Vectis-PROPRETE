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
| M10 | Médiateur de la consommation | O | VECTIS s'adresse aussi à des particuliers (confirmé le 22/11/2026) : l'obligation d'accès à un médiateur (art. L612-1 Code de la consommation) s'applique. **Aucun nom, adresse ni adhésion n'est publié ni affirmé.** | Adhésion ou désignation d'un médiateur par VECTIS ; puis publier ses coordonnées. |
| M11 | Juridiction compétente | R | Clause facultative, inopposable aux consommateurs. | Validation par un conseil. |

## Politique de confidentialité (14)

| # | Marqueur | Classe | Motif | Pour fermer |
|---|---|---|---|---|
| P1 | Date de publication | R | Voir M1. | Date de mise en ligne. |
| P2 | Absence de DPO | C | Désignation obligatoire seulement dans les cas de l'art. 37 RGPD (probablement non applicable). | Confirmation de VECTIS. |
| P3 | Transferts Google (Gmail) hors UE | O | Information obligatoire (art. 13.1.f RGPD). | Conditions/clauses Google applicables au compte de VECTIS. |
| P4 | Entité Hostinger, lieu d'hébergement, garanties | O | Identification des destinataires et des transferts (art. 13.1.e-f). | Contrat/DPA Hostinger. |
| P5 | Autres prestataires de stockage ou de sauvegarde | C | Seulement s'il en existe. | Inventaire des prestataires par VECTIS. |
| P6 | Durée de conservation des devis et photos | O | Art. 13.2.a et 5.1.e RGPD ; aucune suppression automatique n'existe. | Décision de VECTIS (et, si besoin, mise en place d'une purge, hors périmètre de cette PR). |
| P7 | Durée de conservation des e-mails Gmail | O | Idem. | Décision de VECTIS. |
| P8 | Durée de conservation des sauvegardes | O | Idem ; conditionne aussi la mesure d'audience (le secret du jour est dans les sauvegardes). | Décision de VECTIS. |
| P9 | Rotation du journal d'accès Nginx (autres routes) | O | Contient l'adresse IP. | Lecture de la configuration de rotation réelle (autorisation distincte). |
| P10 | Rotation du journal d'erreurs Nginx et des logs Docker | O | Peuvent contenir l'IP. | Idem. |
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
