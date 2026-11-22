# Audit des téléversements et de la transmission des photographies

Audit **en lecture seule** du code de la branche `feat/legal-2-pages` (base `main` `14a95d7`, tête `0bce5f4`). Aucun comportement de production n'a été modifié.
Distinction utilisée : **prouvé** = trouvé dans le code ou la configuration du dépôt ; **non prouvé** = dépend de la configuration réelle du VPS, non consultée.

## 1. Origine des fichiers

| Origine | Qui | Endpoint | Fichier / fonction |
|---|---|---|---|
| Photographies d'une demande de devis | Visiteur (sans compte) | `POST /api/quotes` (crée la demande), `POST /api/quotes/:id/photos` (une photo par requête), `POST /api/quotes/:id/finalize` | `server/src/quotes.js` : `registerQuoteRoutes` (l. 246-390) |
| Images/PDF du site (galerie, logos) | Administrateur connecté | `POST /api/admin/site/assets` | `server/src/site.js` (l. 134 s.) — images **publiées volontairement** par VECTIS, hors données de visiteurs |

Navigateur (`index.html`, `optimizePhoto`, `qphoto`) : envoi vers `/api/quotes/:id/photos` en même origine uniquement (CSP `connect-src 'self'`, `deploy/nginx-devis-vectis-headers.conf` l. 10).

## 2. Validations (photos de devis)

Prouvé (`quotes.js` l. 281-314) : jeton propre à chaque demande (HMAC, `x-quote-token`, comparaison en temps constant) ; index et propriété bornés ; taille ≤ 10 Mo (`IMAGE_MAX`) ; type réel vérifié par signature du contenu (`sniff`, JPG/PNG/WEBP) et identique au `Content-Type` déclaré ; total par demande ≤ 150 Mo (`quoteMaxBytes`) ; ≤ 10 photos par propriété, ≤ 20 propriétés ; limite de débit par IP (`quotePhotoPerIp` 300/h, `quotePerIp` 20/h) ; nom de fichier nettoyé (caractères de contrôle, `/` et `\` remplacés, 120 car.). Nginx : `client_max_body_size 11m` sur `/api/quotes*`.
**Métadonnées d'image (EXIF, lieu, date) :** le serveur ne les supprime pas. Dans le navigateur, seules les photos de plus de 2,5 Mo ou de plus de 3 200 px sont réencodées en JPEG (ce qui n'en conserve pas les métadonnées) ; les autres sont envoyées telles quelles, et l'original est aussi envoyé si le réencodage n'est pas nettement plus léger (`optimizePhoto`).

## 3. Stockage

Prouvé : fichiers écrits dans `<UPLOAD_DIR>/quotes/<id>-<idx>` (répertoire créé en `0700`, fichiers en `0600`, écriture atomique `.part` → renommage), `UPLOAD_DIR` = `<dossier de la base>/uploads` = **`/var/lib/devis-vectis/uploads`** dans le volume Docker nommé `devis_vectis_data` (`docker-compose.yml`). Métadonnées dans la table `quote_photos` (nom de fichier d'origine, type, taille) et la demande dans `quotes` (nom, téléphone, e-mail, propriétés, précisions, estimation). Ces dossiers sont **hors** de la racine web du site (`/opt/devis-vectis`).

## 4. Accès et exposition publique

- Prouvé : aucune route de l'API ne lit ou ne sert les photos de devis, hormis `finalize` qui les relit pour construire l'e-mail (`quotes.js` l. 339). Aucune route d'administration ne liste ni ne sert les demandes ou leurs photos. `GET /api/site/assets/:id` n'accepte que des identifiants de 32 caractères hexadécimaux présents dans la table `assets` ; les fichiers de devis (`<id>-<idx>`, dossier `quotes/`) n'y correspondent pas.
- Prouvé : Nginx (dépôt) bloque `/server/`, `/deploy/`, `/.github/`, fichiers cachés, `*.db`, `*.env`, `*.log`, etc.
- Non prouvé : la configuration Nginx complète du VPS (racine, éventuels alias) n'a pas été relue ; aucun alias vers le volume n'existe dans le dépôt.

## 5. Destinations effectives des photographies

| Destination | Statut | Preuve |
|---|---|---|
| Disque du serveur (volume Docker sur le VPS Hostinger) | **Effectif** | `quotes.js` l. 305-309 ; `docker-compose.yml` |
| **Gmail / Google** (API `gmail.googleapis.com/…/messages/send`) | **Effectif** : les photos sont jointes en pièces jointes MIME à l'e-mail adressé à VECTIS ; destinataire `QUOTE_RECIPIENT` ou, par défaut, `vectis.adm@gmail.com` ; `Reply-To` = e-mail du demandeur ; **aucune copie n'est envoyée au demandeur** | `quotes.js` l. 237-240 et 339-366 ; `mailer.js` l. 253 ; `config.js` l. 4 et 37-41 |
| Copies dans les sauvegardes manuelles (base + dossier `uploads`) | **Effectif** si l'administrateur exécute la procédure | `deploy/BACKUP-SQLITE.md` l. 11 et 54 |
| Autre service externe, API ou tiers | **Aucun trouvé** : les seules URL externes du code serveur sont celles de Google (OAuth, userinfo, envoi Gmail). Aucune bibliothèque d'envoi, de stockage objet ou d'analyse d'image n'est appelée. | recherche dans `server/src/*.js` |

Les journaux de l'application (Docker) enregistrent par défaut l'adresse IP des requêtes, y compris celles de l'envoi de photos (sérialiseur Fastify par défaut ; seule la route `/api/stats/e` est exclue) : `app.js` l. 29-32.

## 6. Conservation et suppression

Prouvé : **aucune suppression** des demandes (`quotes`), des lignes `quote_photos` ni des fichiers `uploads/quotes/*`, après envoi comme en cas d'échec ou d'abandon. Les seules purges du code concernent l'authentification (codes, sessions 24 h ; événements de connexion 180 jours) et les statistiques (90 jours / 25 mois). Les e-mails reçus restent dans Gmail sans règle de suppression connue. Aucun outil de suppression à la demande d'une personne n'existe : traitement manuel.
**Décision de durée : non prise** (marqueurs P6, P7, P8 de `deploy/LEGAL-PENDING.md`).

## 7. Constats et propositions (aucune modification appliquée)

1. Absence de purge : conservation illimitée de données personnelles et de photos (risque de non-conformité à la limitation de conservation, art. 5.1.e RGPD) → décision de durée, puis éventuelle tâche de purge **à autoriser séparément**.
2. Métadonnées des photos non systématiquement supprimées → information donnée dans la politique ; suppression côté navigateur ou serveur possible, **hors périmètre** sans autorisation.
3. Journaux Docker avec IP non bornés dans le temps → durée de rotation à confirmer (P10).
Aucune vulnérabilité concrète d'accès public n'a été identifiée.
