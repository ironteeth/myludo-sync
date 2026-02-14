# Synchronisation MyLudo

Script de synchronisation des emprunts de jeux vers MyLudo.

## Structure du projet

```
ptitsclowns/
├── src/
│   ├── syncLoans.js          # Script principal de synchronisation
│   ├── getCookiesHttp.js     # Gestion de l'authentification MyLudo
│   └── utils.js              # Fonctions utilitaires (HTTP, CSV, email)
├── data/
│   ├── tblMouvements_saison.csv  # Fichier des mouvements d'emprunts
│   └── Export_my_ludo.csv    # Export MyLudo avec mapping des jeux
├── eslint.config.js          # Configuration ESLint
└── package.json              # Dépendances du projet
```

## Scripts disponibles

```bash
# Synchroniser les emprunts
node src/syncLoans.js

# Linter le code
npm run lint

# Corriger automatiquement les problèmes de lint
npm run lint:fix
```

## Utilisation

```bash
node src/syncLoans.js [fichier_mouvements] [fichier_myludo]
```

Par défaut :
```bash
node src/syncLoans.js data/tblMouvements_saison.csv data/Export_my_ludo.csv
```

Avec Url en appelant l'api myLudo :
```bash
node src/syncLoans.js data/tblMouvements_saison.csv  "https://www.myludo.fr/download/collection"
```

## Structure des fichiers CSV

### tblMouvements_saison.csv
Colonnes utilisées :
- `CodeJeu` : Code du jeu (sera mappé vers gameId)
- `DateSortie` : Date de début d'emprunt (format DD/MM/YYYY)
- `DateRetour` : Date de retour (format DD/MM/YYYY, optionnel)

### Export_my_ludo.csv
Colonnes utilisées :
- `ID` : Identifiant MyLudo du jeu
- `Emplacement` : Code du jeu (correspond au CodeJeu)

## Fonctionnement

1. **Chargement du mapping** : Lit Export_my_ludo.csv et crée un mapping Emplacement → ID
2. **Parsing des mouvements** : Lit tblMouvements_saison.csv et convertit les dates
3. **Détermination du gameId** :
   - Si le CodeJeu existe dans le mapping → utilise l'ID MyLudo correspondant
   - Sinon → **ignore la ligne** (seuls les jeux avec emplacement défini sont synchronisés)
4. **Authentification** : Récupère les cookies via getCookiesHttp.js
5. **Synchronisation** : Pour chaque emprunt mappé :
   - Si la date de retour est dépassée → supprime l'emprunt sur MyLudo
   - Si l'emprunt est actif → crée l'emprunt sur MyLudo (si pas déjà présent)

## Statistiques affichées

Le script affiche :
- Nombre de jeux mappés via Export_my_ludo.csv
- Nombre de lignes ignorées (puzzles, données manquantes, jeux sans mapping)
- Nombre d'emprunts actifs vs retournés
- Résumé final : créés, supprimés, erreurs

## Note importante

⚠️ **Seuls les jeux ayant un emplacement défini dans Export_my_ludo.csv seront synchronisés.** Les autres lignes de tblMouvements_saison.csv seront ignorées.

## Installation

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
nvm install 24
sudo ln -s /root/.nvm/versions/node/v24.13.1/bin/node /usr/local/bin/node
timedatectl set-timezone Europe/Paris
mkdir -p /var/www/
cd /var/www/
scp -r myludo-sync [USER]@[SERVER]:/var/www/
npm install

# Configuration des variables d'environnement
cp .env.example .env
# Éditer le fichier .env avec vos identifiants MyLudo

chmod +x run-sync.sh
crontab -e
0 21 * * * /var/www/myludo-sync/run-sync.sh
```

## Configuration

### Variables d'environnement

Créez un fichier `.env` à la racine du projet avec les variables suivantes :

```env
# Identifiants MyLudo
MYLUDO_EMAIL=votre@email.com
MYLUDO_PASSWORD=votre_mot_de_passe

# Credentials Gmail pour l'envoi d'emails d'erreur
GMAIL_USER=votre@email.com
GMAIL_APP_PASSWORD=votre_mot_de_passe_application_gmail
EMAIL_TO=destinataire@email.com
```

**Important** : Le fichier `.env` contient les identifiants et ne doit **jamais** être commité dans Git.
