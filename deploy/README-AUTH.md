# Authentification administrative — mise en service

Principe de sécurité : le compte de déploiement (`devis-deploy`) peut modifier le dépôt mais ne doit jamais
influencer ce que **root** exécute. L'installation initiale se fait donc une seule fois, à la main, depuis une copie
appartenant à root. Les déploiements suivants n'ont besoin que de `sudo systemctl restart devis-vectis-api`.

## 1. Installation initiale (root, une fois)

### 1.1 Obtenir les 5 fichiers depuis le commit audité — pas depuis le dossier du dépôt du serveur
`devis-deploy` peut écrire dans `/opt/devis-vectis` : ne lui faites pas confiance pour ce que root exécute.
Remplacez `<COMMIT>` par le SHA complet du commit relu et validé (visible sur GitHub, immuable) :
```
COMMIT=<sha complet du commit audité>
sudo install -d -m 700 /root/devis-setup && cd /root/devis-setup
for f in setup-server.sh nginx-insert.py devis-vectis-api.service nginx-devis-vectis-api.conf nginx-devis-vectis-headers.conf; do
  sudo curl -fsSL "https://raw.githubusercontent.com/Alex-Vectis-Projetos/Devis-Vectis-PROPRETE/$COMMIT/deploy/$f" -o "$f"
done
```
(Alternative : copier ces fichiers depuis `/opt/devis-vectis/deploy/` — mais alors la comparaison 1.2 est **obligatoire**.)

### 1.2 Établir SHA256SUMS à partir d'une source de confiance et comparer
Sur **votre propre machine** (jamais sur le serveur), dans un clone du dépôt :
```
git checkout <COMMIT> && cd deploy
sha256sum setup-server.sh nginx-insert.py devis-vectis-api.service nginx-devis-vectis-api.conf nginx-devis-vectis-headers.conf > SHA256SUMS
cat SHA256SUMS      # à comparer, ligne à ligne, avec la sortie de la commande ci-dessous sur le serveur
```
Copiez ce `SHA256SUMS` dans `/root/devis-setup/` du serveur, puis :
```
sudo chown -R root:root /root/devis-setup && sudo chmod 644 /root/devis-setup/* && sudo chmod 700 /root/devis-setup
cd /root/devis-setup && sha256sum -c --strict SHA256SUMS          # chaque ligne doit afficher : OK
sha256sum setup-server.sh nginx-insert.py devis-vectis-api.service nginx-devis-vectis-api.conf nginx-devis-vectis-headers.conf   # = votre SHA256SUMS
```
Le script refuse de s'exécuter si : il n'est pas dans une copie dont **tous les dossiers parents** appartiennent à root
et ne sont modifiables par personne d'autre ; si un fichier est un lien symbolique, n'appartient pas à root ou est
modifiable ; si la copie se trouve sous `/opt/devis-vectis` ; si `SHA256SUMS` est absent, incomplet, ou ne correspond pas
au contenu réel des fichiers.

### 1.3 Simulation puis installation
```
# 1) simulation : toutes les validations, AUCUN changement
sudo DEVIS_ADMIN_EMAIL='<adresse administrateur>' bash /root/devis-setup/setup-server.sh --check
# 2) installation
sudo DEVIS_ADMIN_EMAIL='<adresse administrateur>' bash /root/devis-setup/setup-server.sh
```
L'adresse n'accepte que lettres, chiffres et `. _ % + -` ; `DEVIS_DEPLOY_USER` (défaut `devis-deploy`) doit être un nom
d'utilisateur Unix simple. Le script : vérifie `nginx -t` **avant** de toucher quoi que ce soit ; ne modifie que le vhost
dont `server_name` est exactement `devis.mrprop.fr` ; recalcule la modification du vhost juste avant de l'écrire et
s'arrête si le fichier a changé entre-temps ; n'ajoute que les en-têtes de sécurité que le vhost ne définit pas déjà ;
valide le fichier sudoers avant de l'installer (une seule permission : `systemctl restart devis-vectis-api`) ; refait
`nginx -t` à chaque exécution et restaure tout si le test ou le rechargement échoue. Les sauvegardes du vhost sont
dans `/var/backups/devis-vectis/` (jamais à côté des fichiers lus par Nginx). Réexécutable sans risque.

## 2. Application Microsoft Entra (envoi des e-mails via Microsoft Graph)
portal.azure.com → Microsoft Entra ID → Inscriptions d'applications → Nouvelle inscription
- Types de comptes : « Comptes dans un annuaire d'organisation et comptes Microsoft personnels »
- Authentification → Paramètres avancés → **Autoriser les flux clients publics : Oui**
- Autorisations d'API → Microsoft Graph → Déléguées : `Mail.Send`, `User.Read`, `offline_access`
- Copier l'**ID d'application (client)** dans `MS_CLIENT_ID=` de `/etc/devis-vectis/api.env`, puis
  `sudo systemctl restart devis-vectis-api`.

## 3. Autoriser la messagerie (une fois)
Lire le jeton de configuration (réservé à root) : `sudo grep MAIL_SETUP_TOKEN /etc/devis-vectis/api.env`.
Sur https://devis.mrprop.fr : clé du pied de page → saisir ce jeton → « Autoriser la messagerie VECTIS » →
ouvrir la page Microsoft, saisir le code affiché, se connecter avec le compte d'envoi et accepter.
Sans ce jeton, personne ne peut démarrer ni remplacer une autorisation. Une fois la messagerie connectée,
seul un administrateur authentifié peut la modifier. Aucun mot de passe n'est stocké.

## 4. Connexion
Clé du pied de page → e-mail administrateur → code à 6 chiffres reçu par e-mail.
Règles : code valable 10 min, usage unique, 5 essais par code, jusqu'à 3 codes valides en même temps (des demandes
répétées n'invalident jamais un code légitime), **10 essais faux par 24 h = connexion par code suspendue** (réponse
identique à un code faux). Pour lever une suspension : 
```
sudo -u devis-vectis-api bash -c 'set -a; . /etc/devis-vectis/api.env; set +a; cd /opt/devis-vectis/server && node scripts/unlock-admin.js'
```
(La lecture de `api.env` se fait **dans** le shell du compte du service, qui seul peut le lire : ne pas la déplacer dans
une substitution `$(…)` hors du `sudo`.)
Les blocages sont journalisés dans `auth_events` (`admin_locked`, `code_request_blocked_locked`, …).

## 5. À configurer côté GitHub (recommandé)
- Secret `VPS_HOST_KEY` : sortie de `ssh-keyscan -p <port> <hôte>` relevée depuis une source de confiance, pour que
  le déploiement vérifie l'empreinte du serveur (sinon avertissement à chaque exécution).
- Protection de la branche `main` : pull request obligatoire, contrôle « CI » requis ; 2FA sur le compte GitHub.
