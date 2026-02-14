#!/bin/bash

SCRIPT_DIR="/var/www/myludo-sync"
LOG_FILE="$SCRIPT_DIR/sync.log"

cd "$SCRIPT_DIR" || exit 1

# - Fichiers locaux : node src/syncLoans.js data/tblMouvements_saison.csv data/Export_my_ludo.csv
node src/syncLoans.js data/tblMouvements_saison.csv  "https://www.myludo.fr/download/collection" 2>&1 | while IFS= read -r line; do
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $line" >> "$LOG_FILE"
done
EXIT_CODE=${PIPESTATUS[0]}

if [ $EXIT_CODE -eq 0 ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Synchronisation terminée avec succès" >> "$LOG_FILE"
else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERREUR: Synchronisation échouée (code: $EXIT_CODE)" >> "$LOG_FILE"
fi

exit $EXIT_CODE
