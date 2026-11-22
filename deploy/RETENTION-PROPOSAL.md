# Proposition de politique de conservation — DOCUMENT DE DÉCISION (rien n'est implémenté)

Aucune suppression automatique n'est ajoutée par cette PR. Ce document sépare, pour chaque catégorie : **obligation légale**, **recommandation CNIL**, **décision interne de VECTIS**.
Les durées marquées « proposition » ne sont **pas** publiées dans les pages et ne deviennent des engagements qu'après décision écrite de VECTIS et validation par un conseil.
Sources consultées : CNIL, référentiel « gestion des activités commerciales » (prospects : 3 ans ; contrats : durée de la relation puis archivage intermédiaire ; exemple d'obligation comptable : 10 ans) et recommandation « journalisation » (6 mois à 1 an). Les références légales ci-dessous n'ont pas pu être relues sur Légifrance : à valider.

## Constat actuel (prouvé, `deploy/UPLOADS-AUDIT.md`)
Demandes, photos, fichiers, e-mails Gmail et sauvegardes manuelles : conservation **illimitée**, sans purge. Journaux Docker : rotation non connue (à vérifier, `deploy/VPS-AUDIT-READONLY.md`). Journaux de connexion admin : 180 jours ; sessions et codes : 24 h ; statistiques : 90 jours / 25 mois.

## Tableau par catégorie

| Catégorie | Obligation légale | Recommandation CNIL | Proposition (à décider par VECTIS) | Marqueur |
|---|---|---|---|---|
| **Devis non convertis** (demande reçue, aucun contrat) — lignes de `quotes`, `quote_photos` | Aucune durée imposée ; principe de limitation (art. 5.1.e RGPD) | Prospect : 3 ans à partir de la collecte ou du dernier contact émanant de la personne (référentiel gestion commerciale) | 3 ans maximum à compter du dernier contact (ou moins) ; passé ce délai : suppression ou anonymisation | P6 |
| **Clients et contrats** (devis accepté, contrat, factures) | Pièces comptables : 10 ans (Code de commerce, L123-22) ; contrats électroniques d'au moins 120 € avec un consommateur : 10 ans (Code de la consommation, L213-1) ; prescription de droit commun : 5 ans (Code civil, art. 2224) — à valider | Données du contrat : durée de la relation, puis archivage intermédiaire pour la durée légale ou la prescription, hors base active | Base active pendant la relation ; archivage restreint ensuite (10 ans pour les pièces comptables) ; **ce stockage n'existe pas encore dans l'application** (aucune facture ni contrat n'y est géré) | P6 |
| **Photographies** (fichiers `uploads/quotes`) | Aucune durée propre | Suivre la finalité : utiles pour établir le devis et exécuter la prestation | Devis non converti : supprimer avec la demande ; client : supprimer à la fin de la prestation ou conserver comme preuve d'état des lieux si VECTIS le décide et l'indique | P6 |
| **E-mails Gmail** (demande + photos) | Dépend du contenu (devis, contrat, facture) | Mêmes durées que la catégorie du contenu | Appliquer les durées ci-dessus ; règle d'archivage ou de suppression à définir dans Gmail ; **une copie contient les photos** | P7 |
| **Sauvegardes** (base + dossier des photos) | Aucune | Durée courte et rotation ; une demande d'effacement doit être répercutée à l'expiration des sauvegardes | Rotation définie (valeur à choisir par VECTIS), lieu et chiffrement documentés ; durée publiée dans la politique | P8, P14 |
| **Journaux Nginx** (adresse IP) | Les hébergeurs et fournisseurs d'accès doivent conserver 1 an les données d'identification (LCEN, art. 6 II) : concerne l'hébergeur, à confirmer pour VECTIS | 6 mois à 1 an en règle générale (recommandation journalisation) | ≤ 6 mois sauf besoin justifié ; durée = celle réellement configurée (audit VPS) | P9 |
| **Journaux Docker / erreurs** | Idem | Idem | Rotation bornée (taille et nombre de fichiers) ; durée à publier | P10 |
| **Mesure d'audience** | Aucune (si activée) | Données statistiques : 25 mois maximum (déjà appliqué) | Inchangé : 90 jours / 25 mois | — |

## Décisions à prendre (checklist)
1. Durée des devis non convertis (≤ 3 ans proposé).
2. Existence et lieu d'un archivage des contrats et factures (hors application aujourd'hui).
3. Sort des photographies d'un client après la prestation.
4. Règle Gmail (archivage / suppression) et personne responsable.
5. Rotation des sauvegardes et lieu de stockage.
6. Rotation des journaux Nginx et Docker, après lecture des valeurs réelles.
7. Procédure de réponse aux demandes d'effacement (manuelle aujourd'hui) incluant sauvegardes et Gmail.

## Mise en œuvre ultérieure (hors de cette PR, autorisation séparée)
Outil de purge idempotent et testé (demandes + `quote_photos` + fichiers), journalisation sans donnée personnelle, essai à blanc, sauvegarde préalable. Rien de cela n'est développé ici.
