# Authentification administrative — mise en service

Principe de sécurité : le compte de déploiement (`devis-deploy`) peut modifier le dépôt mais ne doit jamais
influencer ce que **root** exécute. L'installation initiale se fait donc une seule fois, à la main, depuis une copie
appartenant à root. Les déploiements suivants n'ont besoin que de `sudo systemctl restart devis-vectis-api`.

## 1. Installation initiale (root, une fois)
```
# vérifier que le serveur est bien sur le commit relu
git -C /opt/devis-vectis rev-parse HEAD

sudo install -d -m 700 /root/devis-setup
sudo cp /opt/devis-vectis/deploy/{setup-server.sh,nginx-insert.py,devis-vectis-api.service,nginx-devis-vectis-api.conf} /root/devis-setup/
sudo chown -R root:root /root/devis-setup && sudo chmod 644 /root/devis-setup/*

# 1) simulation : toutes les validations, AUCUN changement
sudo DEVIS_ADMIN_EMAIL='<adresse administrateur>' bash /root/devis-setup/setup-server.sh --check
# 2) installation
sudo DEVIS_ADMIN_EMAIL='<adresse administrateur>' bash /root/devis-setup/setup-server.sh
```
Le script : refuse des sources non-root ; vérifie `nginx -t` **avant** de toucher quoi que ce soit ; ne modifie que le
vhost dont `server_name` est exactement `devis.mrprop.fr` ; valide le fichier sudoers avant de l'installer ; refait
`nginx -t` à chaque exécution et restaure tout si le test ou le rechargement échoue. Réexécutable sans risque.

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
sudo -u devis-vectis-api env $(grep -vE '^#|^$' /etc/devis-vectis/api.env | xargs) node /opt/devis-vectis/server/scripts/unlock-admin.js
```
Les blocages sont journalisés dans `auth_events` (`admin_locked`, `code_request_blocked_locked`, …).

## 5. À configurer côté GitHub (recommandé)
- Secret `VPS_HOST_KEY` : sortie de `ssh-keyscan -p <port> <hôte>` relevée depuis une source de confiance, pour que
  le déploiement vérifie l'empreinte du serveur (sinon avertissement à chaque exécution).
- Protection de la branche `main` : pull request obligatoire, contrôle « CI » requis ; 2FA sur le compte GitHub.
