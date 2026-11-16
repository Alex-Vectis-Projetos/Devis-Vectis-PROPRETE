# Sauvegarde et restauration du SQLite de production (avant déploiement)

Document de procédure — **à exécuter par un humain sur le VPS**. Rien ici n'est lancé automatiquement par le CI ni par `post-deploy.sh`.

## 1. Ce que dit la configuration existante

D'après `docker-compose.yml` et `server/src/` :

- Service `api`, conteneur `devis-vectis-api`, utilisateur `node` (non root), `cap_drop: ALL`.
- Base : `DB_PATH=/var/lib/devis-vectis/devis.db`, dans le volume nommé **`devis_vectis_data`** monté sur `/var/lib/devis-vectis`.
- Les pièces jointes des devis sont dans le **même volume** : `/var/lib/devis-vectis/uploads/` (`UPLOAD_DIR` par défaut = `<dossier de la base>/uploads`). Une sauvegarde de la seule base est donc incomplète : sans `uploads/`, les photos/PDF des devis ne seraient pas restaurés.
- `server/src/db.js` ouvre la base en **mode WAL** (`journal_mode = WAL`, `synchronous = NORMAL`). Conséquence : une copie « à froid » du seul fichier `devis.db` pendant que l'API tourne peut être **incohérente** (des écritures récentes sont dans `devis.db-wal`). Il ne faut pas faire un simple `cp devis.db`.
- Le schéma est migré au démarrage (`PRAGMA user_version`, migrations en avant seulement). Le déploiement des versions 22 ne modifie **aucun** fichier de `server/src/` (diff `main..fix/categories-places` : uniquement `index.html`, `admin-inline.js` et des tests) : la base n'est pas touchée par le code déployé. La sauvegarde est une précaution, et le point de retour si une version future migre le schéma.
- L'image d'exécution n'embarque **pas** la CLI `sqlite3` : la procédure utilise `node` + `better-sqlite3`, déjà présents dans le conteneur.

## 2. Méthode retenue : instantané cohérent « à chaud » avec `VACUUM INTO`

`VACUUM INTO 'fichier'` produit, dans une transaction de lecture, une copie complète et cohérente de la base (WAL compris) **sans arrêter l'API** et sans bloquer les écritures plus que le temps de la lecture. Le fichier obtenu est une base autonome (un seul fichier, pas de `-wal`/`-shm`). La méthode a été validée en local avec une base WAL ouverte en écriture : copie cohérente, `integrity_check = ok`, écritures postérieures absentes de la copie. (Non testée sur le VPS : voir « Risques ».)

Prérequis : espace disque libre ≥ taille de la base + `uploads/` (vérifier avec `docker compose exec -T api df -h /var/lib/devis-vectis /tmp`, et `df -h` sur l'hôte pour le dossier de sauvegarde).

### 2.1 Sauvegarde (depuis `/opt/devis-vectis`, sans `sudo`)

```bash
cd /opt/devis-vectis
TS=$(date +%F-%H%M%S)
BK="${BK:-$HOME/backups-devis-vectis}"      # ou /var/backups/devis-vectis si l'utilisateur de déploiement peut y écrire
mkdir -p "$BK" && chmod 700 "$BK"

# 1) instantané cohérent + vérification, À L'INTÉRIEUR du conteneur (fichier temporaire dans /tmp du conteneur)
docker compose exec -T api node -e '
const D = require("better-sqlite3");
const src = process.env.DB_PATH, out = "/tmp/pre-deploy.db";
require("fs").rmSync(out, { force: true });
const r = new D(src, { readonly: true, fileMustExist: true });
r.exec("VACUUM INTO \x27" + out + "\x27");
r.close();
const b = new D(out, { readonly: true });
const ic = b.pragma("integrity_check", { simple: true });
const fk = b.pragma("foreign_key_check").length;
const uv = b.pragma("user_version", { simple: true });
const tabs = b.prepare("SELECT name FROM sqlite_master WHERE type=\x27table\x27 AND name NOT LIKE \x27sqlite_%\x27 ORDER BY name").all().map(t => t.name);
console.log("integrity_check=" + ic, "| foreign_key_violations=" + fk, "| user_version=" + uv);
tabs.forEach(t => console.log(t + ": " + b.prepare("SELECT COUNT(*) c FROM \"" + t + "\"").get().c + " lignes"));
b.close();
if (ic !== "ok" || fk !== 0) process.exit(1);
'

# 2) sortir le fichier du conteneur, puis effacer le temporaire
docker compose cp api:/tmp/pre-deploy.db "$BK/devis-$TS.db"
docker compose exec -T api rm -f /tmp/pre-deploy.db

# 3) les pièces jointes (même volume)
docker compose cp api:/var/lib/devis-vectis/uploads "$BK/uploads-$TS"

# 4) empreinte et taille, à noter dans le journal de déploiement
sha256sum "$BK/devis-$TS.db" | tee "$BK/devis-$TS.db.sha256"
ls -l "$BK/devis-$TS.db"; du -sh "$BK/uploads-$TS"
```

**Critère de passage** : la commande 1 doit afficher `integrity_check=ok` et `foreign_key_violations=0` (sinon elle sort en erreur et **le déploiement ne doit pas continuer**), et les nombres de lignes doivent être plausibles (devis, contenus du site, etc. non nuls si la production en contient).

### 2.2 Vérifier l'intégrité d'une sauvegarde existante (plus tard, ou avant une restauration)

```bash
cd /opt/devis-vectis
sha256sum -c "$BK/devis-$TS.db.sha256"        # le fichier n'a pas changé depuis la sauvegarde

docker compose run --rm --no-deps -v "$BK":/bk:ro api node -e '
const D = require("better-sqlite3");
const b = new D("/bk/" + process.argv[1], { readonly: true, fileMustExist: true });
console.log("integrity_check=" + b.pragma("integrity_check", { simple: true }), "| user_version=" + b.pragma("user_version", { simple: true }));
' "devis-$TS.db"
```

`docker compose run --rm --no-deps` crée un conteneur jetable du service `api` (même image, même volume), **sans** toucher aux autres services et sans démarrer l'API ; le dossier de sauvegarde est monté en lecture seule. Le fichier doit être lisible par l'utilisateur `node` du conteneur (UID 1000) : `chmod 644 "$BK/devis-$TS.db"` si nécessaire.

## 3. Déploiement (rappel, inchangé)

Le déploiement reste celui de `.github/workflows/deploy.yml` (push sur `main` → tests CI → SSH → `git pull --ff-only` → `deploy/post-deploy.sh`). La sauvegarde ci-dessus est faite **avant** de fusionner dans `main`. Le volume `devis_vectis_data` n'est ni supprimé ni recréé par `docker compose up -d --no-deps api`. N'exécuter ni `docker compose down -v`, ni `docker volume rm`, ni `docker system prune --volumes`.

## 4. Restauration

Quand : la base est corrompue ou des données ont été perdues après le déploiement. Elle remplace la base par la sauvegarde choisie ; **les devis créés après la sauvegarde sont perdus** : ne restaurer que sur décision explicite.

```bash
cd /opt/devis-vectis

# 0) vérifier d'abord la sauvegarde (section 2.2). Ne continuer que si integrity_check=ok.

# 1) arrêter UNIQUEMENT l'API (les autres projets ne sont pas concernés)
docker compose stop api

# 2) garder une copie de sécurité de l'état actuel du volume (base + -wal + -shm + uploads)
docker compose cp api:/var/lib/devis-vectis/. "$BK/avant-restauration-$(date +%F-%H%M%S)/"

# 3) restaurer, avec l'utilisateur « node » du conteneur (les fichiers gardent les bons droits)
docker compose run --rm --no-deps -v "$BK":/bk:ro api node -e '
const fs = require("fs");
const dir = require("path").dirname(process.env.DB_PATH);
["", "-wal", "-shm"].forEach(s => fs.rmSync(process.env.DB_PATH + s, { force: true }));   // le WAL de l\x27ancienne base ne doit pas être rejoué sur la sauvegarde
fs.copyFileSync("/bk/" + process.argv[1], process.env.DB_PATH);
if (process.argv[2]) { fs.rmSync(dir + "/uploads", { recursive: true, force: true }); fs.cpSync("/bk/" + process.argv[2], dir + "/uploads", { recursive: true }); }
const D = require("better-sqlite3");
const b = new D(process.env.DB_PATH, { readonly: true });
console.log("après restauration : integrity_check=" + b.pragma("integrity_check", { simple: true }));
b.close();
' "devis-$TS.db" "uploads-$TS"        # supprimer le 2e argument pour ne restaurer que la base

# 4) redémarrer l'API et contrôler
docker compose up -d --no-deps api
curl -fsS http://127.0.0.1:3100/api/health
```

Si le code a été ramené à une version antérieure en même temps (retour arrière du déploiement) : `cd /opt/devis-vectis && git checkout <commit précédent>` (ou `git revert` du merge côté GitHub puis nouveau déploiement), puis `docker compose build api && docker compose up -d --no-deps api`. Une base déjà migrée vers un schéma plus récent doit être restaurée **avec** ce retour arrière (les migrations ne sont pas réversibles).

## 5. Ce que cette procédure ne fait pas

- Elle ne lit pas et n'affiche pas `/etc/devis-vectis/api.env` (secrets, OAuth Gmail) ; ce fichier est hors volume et n'est pas modifié par un déploiement. Sa sauvegarde éventuelle est un sujet séparé, à traiter par son propriétaire.
- Elle n'automatise rien (pas de cron) : la planification de sauvegardes régulières est une décision à part.
- Les sauvegardes contiennent des données clients (devis, pièces jointes) : dossier en `chmod 700`, hors du répertoire servi par Nginx, jamais dans Git.
