# Informations juridiques en attente — classement des 27 marqueurs « À COMPLÉTER »

État : branche `feat/legal-2-pages`. Contrôle : `node server/test/legal-ready.check.js` (échoue tant qu'il reste un marqueur).
Classes : **O** obligatoire · **C** applicable sous conditions · **R** recommandé · **N** non applicable (par défaut).
Rien n'est inventé : chaque ligne indique la source attendue. Les textes de loi n'ont pas pu être relus en entier dans cette session (Légifrance inaccessible) : à vérifier par le conseil.

## Mentions légales (11)

| # | Marqueur | Classe | Pourquoi / source attendue |
|---|---|---|---|
| M1 | Date de publication | R | Pas exigée par la loi ; utile pour la traçabilité. Date du jour de mise en ligne. |
| M2 | Téléphone public de VECTIS | O | L'identification de l'éditeur personne morale comprend un moyen de contact téléphonique (art. 1-1 loi 2004-575, ancien art. 6 III). Le numéro +33 7 80 25 11 28 figure seulement dans les instructions du client, pas dans le Kbis, l'INPI ou les statuts : **à confirmer par VECTIS**. |
| M3 | Raison sociale de l'entité Hostinger | O | Identité de l'hébergeur (même article). Source : facture ou conditions de service Hostinger. |
| M4 | Adresse de l'hébergeur | O | Idem. |
| M5 | Téléphone de l'hébergeur | O | Idem. |
| M6 | Justificatif du titulaire du domaine | R | Non exigé dans les mentions ; titulaire indiqué : VECTIS. Source : registrar. |
| M7 | Titularité patrimoniale du site (cession auteur → VECTIS) | C | Seulement si la rubrique de propriété intellectuelle revendique des droits au nom de VECTIS. Source : contrat de cession. |
| M8 | Origine et droits des images de la galerie | O | La vérification des droits (auteur, droit à l'image) est obligatoire avant diffusion ; la mention publique est recommandée. Source : contrats ou licences. |
| M9 | Dépôt de marque INPI | N | Seulement si VECTIS revendique une marque. Sinon supprimer la ligne. |
| M10 | Médiation de la consommation | C | Obligatoire si VECTIS sert des consommateurs (art. L612-1 Code de la consommation). L'objet social inclut des locaux résidentiels et des véhicules : à trancher par VECTIS. |
| M11 | Juridiction compétente | R | Clause facultative ; inopposable aux consommateurs. À valider par le conseil. |

## Politique de confidentialité (14)

| # | Marqueur | Classe | Pourquoi / source attendue |
|---|---|---|---|
| P1 | Date de publication | R | Voir M1. |
| P2 | Absence de DPO | C | Désignation obligatoire seulement dans les cas de l'art. 37 RGPD (probablement non applicable) ; confirmation de VECTIS. |
| P3 | Transferts Google (Gmail) hors UE | O | Information obligatoire sur les transferts (art. 13.1.f RGPD). Source : conditions Google applicables à VECTIS. |
| P4 | Entité Hostinger, lieu d'hébergement, garanties | O | Identification des destinataires et des transferts (art. 13.1.e-f). |
| P5 | Autres prestataires de stockage ou de sauvegarde | C | Seulement s'il en existe. |
| P6 | Durée de conservation des devis et photos | O | Art. 13.2.a et 5.1.e RGPD ; décision de VECTIS. |
| P7 | Durée de conservation des e-mails Gmail | O | Idem. |
| P8 | Durée de conservation des sauvegardes | O | Idem ; conditionne aussi la mesure d'audience (secret du jour dans les sauvegardes). |
| P9 | Rotation du journal d'accès Nginx (autres routes) | O | Contient l'adresse IP : durée à fixer. |
| P10 | Rotation du journal d'erreurs Nginx et des logs Docker | O | Peuvent contenir l'IP : durée à fixer. |
| P11 | Délai de réponse et justificatif d'identité | R | Le délai légal est d'un mois (art. 12.3 RGPD) et peut être repris tel quel ; le justificatif est facultatif. |
| P12 | Décision juridique sur la base de la mesure (intérêt légitime ou consentement) | O | Avant activation : voir `deploy/PRIVACY-CNIL-ASSESSMENT.md`. |
| P13 | État de la mesure à la date de publication | O | Exactitude de l'information (« non activée » / « activée depuis le … »). |
| P14 | Durée des sauvegardes (rubrique audience) | O | Même décision que P8. |

## Gestion des cookies (2)

| # | Marqueur | Classe | Pourquoi / source attendue |
|---|---|---|---|
| C1 | Date de publication | R | Voir M1. |
| C2 | Vérification des en-têtes `Set-Cookie` en production | O | La page affirme l'absence de cookie visiteur : l'affirmation doit être vérifiée avant publication (lecture seule, depuis un navigateur ou `curl -sI`). |

## Synthèse
Obligatoires : M2, M3, M4, M5, M8, P3, P4, P6, P7, P8, P9, P10, P12, P13, P14, C2 (16). Sous conditions : M7, M10, P2, P5 (4). Recommandés : M1, M6, M11, P1, P11, C1 (6). Non applicable par défaut : M9 (1).
Total 27. Changements depuis le décompte précédent : directeur de la publication **résolu** (Présidente, Kbis) ; téléphone devenu pendant ; décision juridique sur la mesure ajoutée.
