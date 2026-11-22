# Registre des informations juridiques en attente (interne, non publié)

Mise à jour du **22 novembre 2026**. Les pages publiques ne contiennent plus aucun marqueur « À COMPLÉTER », aucun encadré de pendances et aucun message « ne pas publier » (verrouillé par test). Ce qui n'est pas confirmé a été **retiré de l'affichage public**, jamais rempli par supposition. Ce registre garde la trace de ce qui reste à documenter.
Les pages ne déclarent **aucune conformité juridique complète**. Les textes de loi n'ont pas pu être relus en entier (Légifrance inaccessible depuis la session de travail) : les citations sont à valider par un conseil.
Statuts : **Résolu** (information confirmée par VECTIS, affichée) · **Retiré** (champ supprimé de la page ; reste à documenter ou à décider en interne) · **Ouvert** (pas d'information ; non affiché).
Classes d'origine : **O** obligatoire · **C** applicable sous conditions · **R** recommandé · **N** non applicable.

## Décisions et confirmations du 22/11/2026
- Téléphone public +33 7 80 25 11 28 ; e-mail juridique adm@vectis-pro.fr ; e-mail administratif vectis.adm@gmail.com ; domaine devis.mrprop.fr, titulaire VECTIS ; hébergement « Hostinger — Serveur privé virtuel (VPS) » : confirmés par VECTIS, affichés.
- Mesure d'audience : voie **B (consentement préalable)** retenue ; mécanisme implémenté, **collecte toujours désactivée** (`STATS_ENABLED=false`).

## À trancher séparément : représentante légale et directrice de la publication
Le Kbis (16/07/2026) désigne Lucia DE FATIMA DA SILVA comme Présidente. L'éditeur du site étant une personne morale, la loi (art. 1-1 loi 2004-575 ; art. 93-2 loi 82-652) fait du représentant légal le directeur de la publication, et la loi impose d'identifier l'éditeur. **Les mentions légales identifient donc toujours la Présidente** (représentation légale et direction de la publication) : retirer cette information masquerait une divergence sans la résoudre. Elle n'apparaît ni sur la page « Qui sommes-nous ? », ni sur la page d'accueil. Alex Da Silva De Souza y figure comme associé unique, administrateur responsable et représentant par délégation, dans les limites des pouvoirs délégués (délégation du 13/07/2026) ; les mentions légales ne lui attribuent ni la présidence ni une qualité de représentant légal statutaire. Si VECTIS veut un autre directeur de la publication ou une autre représentation, cela passe par un acte de société (nomination d'un nouveau président) et par le Kbis, pas par le texte du site.

## Contact affiché sur le site (23/11/2026)
Le bloc de contact de l'accueil vient du **contenu administrable enregistré en base**, qui prévaut sur le HTML. En production il affichait l’ancienne adresse e-mail (domaine hotmail, ne plus utiliser) et le téléphone `0780251128`. Correction à faire par l'administration existante (aucune modification de la base par le dépôt) : valeurs `vectis.adm@gmail.com` et `+33 7 80 25 11 28`. Les valeurs du code (`CONTACT_DEF`) ne servent que si le champ est vide.

## Registre
| # | Sujet | Classe | Statut | Situation actuelle / pour fermer |
|---|---|---|---|---|
| M1 | Date de mise à jour (mentions) | R | Résolu | « 22 novembre 2026 ». À mettre à jour à chaque modification. |
| M2 | Téléphone public | O | Résolu | Confirmé par VECTIS le 22/11/2026. Reste à conserver une preuve écrite (aucun document officiel ne le mentionne). |
| M3 | Raison sociale de l'entité Hostinger | O | Retiré | Page : « Hostinger — Serveur privé virtuel (VPS) ». L'art. 1-1 LCEN attend nom, dénomination, adresse et téléphone de l'hébergeur : à documenter à partir de la facture ou des conditions Hostinger. |
| M4 | Adresse de l'hébergeur | O | Retiré | Idem M3. |
| M5 | Téléphone de l'hébergeur | O | Retiré | Idem M3. |
| M6 | Justificatif du titulaire du domaine | R | Résolu | Titulaire : VECTIS (confirmé). Conserver la fiche du registrar. |
| M7 | Titularité patrimoniale du site ; attribution de la conception | C | Retiré | La page attribue la conception à Alex Da Silva De Souza (auteur) et ne mentionne plus le titulaire des droits patrimoniaux ; aucune cession n'est affirmée. À fermer : contrat de cession ou déclaration d'auteur. |
| M8 | Origine et droits des images | O | Retiré | Inspection du dépôt : seuls fichiers d'images versionnés = logo et QR MR PROP (`assets/`, tiers) ; l'index embarque le logo VECTIS et des vignettes de catégories par défaut (data URI, origine non documentée) ; les photos de la galerie sont des fichiers téléversés par l'administration (table `assets`, champ `created_by` = administrateur ayant téléversé, aucune licence ni auteur enregistrés). La page dit seulement que ces visuels restent soumis aux droits de leurs titulaires. À fermer : origine et licence de chaque image, ou retrait. |
| M9 | Dépôt de marque INPI | N | Retiré | Mention supprimée ; aucune marque revendiquée. |
| M10 | Médiateur de la consommation | O | Retiré | VECTIS s'adresse aussi à des particuliers : l'accès à un médiateur (art. L612-1 Code de la consommation) est obligatoire. Aucun médiateur désigné ou adhéré (aucun document) ; la médiation n'est donc pas opérationnelle. La rubrique a été retirée de la page publique pour ne rien affirmer ; **risque de non-conformité à traiter** : choisir un médiateur, adhérer, puis publier ses coordonnées (et dans les CGV). |
| M11 | Juridiction compétente | R | Retiré | La page indique seulement le droit français. Clause facultative, inopposable aux consommateurs ; à valider par un conseil. |
| P1 | Date de mise à jour (politique) | R | Résolu | « 22 novembre 2026 ». |
| P2 | Délégué à la protection des données | C | Retiré | Phrase supprimée. Confirmer l'absence de DPO (obligatoire seulement dans les cas de l'art. 37 RGPD). |
| P3 | Transferts Google (Gmail) hors UE | O | Retiré | La page dit que Google traite selon ses propres conditions. Art. 13.1.f RGPD : documenter les clauses applicables au compte de VECTIS. |
| P4 | Entité Hostinger, lieu d'hébergement, garanties | O | Retiré | Idem M3 ; contrat ou DPA Hostinger. |
| P5 | Autres prestataires de stockage ou sauvegarde | C | Retiré | Ligne supprimée. Inventaire à faire par VECTIS. |
| P6 | Durée de conservation des devis et photos | O | Retiré | La page dit : conservés le temps nécessaire, aucune suppression automatique à ce jour, effacement sur demande. Durée à décider : `deploy/RETENTION-PROPOSAL.md`. |
| P7 | Durée de conservation des e-mails Gmail | O | Retiré | Même formulation ; règle à décider. |
| P8 | Durée de conservation des sauvegardes | O | Retiré | La page dit : conservées pour restaurer le service, aucune suppression automatique. Décision à prendre (durée et lieu). |
| P9 | Rotation du journal d'accès Nginx | O | Retiré | Aucune durée affichée. Lire la configuration réelle : `deploy/VPS-AUDIT-READONLY.md`. |
| P10 | Rotation des journaux d'erreurs et Docker | O | Retiré | Idem. |
| P11 | Délai de réponse et justificatif d'identité | R | Résolu | Justificatif en cas de doute raisonnable ; le délai légal d'un mois (art. 12.3 RGPD) n'est pas promis autrement. |
| P12 | Base juridique de la mesure d'audience | O | Résolu | Voie B : consentement, implémenté, testé. Validation par un conseil recommandée : `deploy/PRIVACY-CNIL-ASSESSMENT.md`. |
| P13 | État de la mesure à la date de publication | O | Résolu | Texte indépendant de l'état : tant que le serveur n'active pas la mesure, aucun bandeau ni événement. |
| P14 | Durée des sauvegardes (rubrique audience) | O | Retiré | Voir P8 ; la page rappelle que les sauvegardes contiennent le secret du jour. |
| C1 | Date de mise à jour (cookies) | R | Résolu | « 22 novembre 2026 ». |
| C2 | Vérification des en-têtes `Set-Cookie` en production | O | Retiré | Phrase supprimée de la page. Vérification en lecture seule : `deploy/VPS-AUDIT-READONLY.md` §F. |

## Synthèse (27 lignes)
- **Résolu** : M1, M2, M6, P1, P11, P12, P13, C1.
- **Retiré de l'affichage, à documenter ou à décider** : M3, M4, M5, M7, M8, M9, M10, M11, P2, P3, P4, P5, P6, P7, P8, P9, P10, P14, C2.
- Total 27.
- **Obligations qui restent ouvertes malgré l'absence de marqueur public** : M3-M5 et P4 (identité de l'hébergeur), M8 (droits des images), M10 (médiateur), P3, P6 à P10 et P14 (conservation, transferts, journaux).

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

## Classement pour la suite
**À traiter en priorité (obligations ouvertes, sans effet sur le fonctionnement du site)** : identité de l'hébergeur (M3-M5, P4), médiateur de la consommation (M10), droits des images (M8), décisions de conservation (P6 à P8, P14) et lecture des journaux (P9, P10, C2, après l'audit en lecture seule du VPS : `deploy/VPS-AUDIT-READONLY.md`), clauses Google (P3).
**Peuvent attendre** : M7 (cession), M11 (juridiction), P2 (DPO), P5 (autres prestataires), M9.
**Chantiers distincts** : CGV (`deploy/CGV-SURVEY.md`), politique de conservation et purge (`deploy/RETENTION-PROPOSAL.md`), assurance, informations pour les particuliers (B2C).
**Avant d'activer la mesure d'audience** : tests de consentement verts (ce dépôt), validation par un conseil, et décision écrite de VECTIS ; puis `STATS_ENABLED=true` par une autorisation séparée.
