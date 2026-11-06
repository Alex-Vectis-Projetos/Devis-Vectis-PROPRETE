# Authentification administrative — mise en service

## 1. Une seule fois, en root sur le VPS
```
sudo bash /opt/devis-vectis/deploy/setup-server.sh
```
Crée l'utilisateur `devis-vectis-api`, `/etc/devis-vectis/api.env` (secret généré sur place),
le service systemd (127.0.0.1:3100), le droit `sudo systemctl restart devis-vectis-api` pour `devis-deploy`,
et branche Nginx (sauvegarde du vhost, `nginx -t`, retour arrière automatique).

## 2. Application Microsoft Entra (envoi des e-mails via Microsoft Graph)
portal.azure.com → Microsoft Entra ID → Inscriptions d'applications → Nouvelle inscription
- Types de comptes : « Comptes dans un annuaire d'organisation et comptes Microsoft personnels »
- Authentification → Paramètres avancés → **Autoriser les flux clients publics : Oui**
- Autorisations d'API → Microsoft Graph → Déléguées : `Mail.Send`, `User.Read`, `offline_access`
- Copier l'**ID d'application (client)** dans `MS_CLIENT_ID=` de `/etc/devis-vectis/api.env`, puis
  `sudo systemctl restart devis-vectis-api`.

## 3. Autoriser la messagerie (une fois)
Sur https://devis.mrprop.fr : clé du pied de page → « Autoriser la messagerie VECTIS » →
ouvrir la page Microsoft, saisir le code affiché, se connecter avec `vectis.adm@hotmail.com` et accepter.
Aucun mot de passe n'est stocké ; seul un jeton de renouvellement chiffré est conservé en base.

## 4. Connexion
Clé du pied de page → e-mail administrateur → code à 6 chiffres reçu par e-mail.
