const fs = require('fs');
const { parse } = require('csv-parse/sync');
const { getCookies } = require('./getCookiesHttp');
const {
  makeRequest,
  cookiesToString,
  extractCsrfToken,
  createMultipartBody,
  sendErrorEmail,
  isUrl,
  fetchCsvContent
} = require('./utils');


async function syncLoans(csvFile, myLudoCsvFile) {
  console.log('=== Synchronisation des emprunts MyLudo ===\n');

  // Charger les cookies avant tout pour pouvoir télécharger le fichier MyLudo si besoin
  const cookies = await loadCookies();

  // Télécharger ou lire le fichier MyLudo
  let myLudoCsvContent;
  if (isUrl(myLudoCsvFile)) {
    // Si c'est une URL MyLudo, ajouter les paramètres par défaut si nécessaire
    let myLudoUrl = myLudoCsvFile;
    if (myLudoUrl.includes('myludo.fr') && !myLudoUrl.includes('format=csv')) {
      const url = new URL(myLudoUrl);
      if (!url.searchParams.has('format')) {
        url.searchParams.set('format', 'csv');
      }
      if (!url.searchParams.has('date')) {
        // Date d'un an en arrière
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        const dateStr = oneYearAgo.toISOString().split('T')[0];
        url.searchParams.set('date', dateStr);
      }
      myLudoUrl = url.toString();
    }
    myLudoCsvContent = await fetchCsvContent(myLudoUrl, cookies);
  } else {
    myLudoCsvContent = await fetchCsvContent(myLudoCsvFile);
  }

  // Construire le mapping CodeJeu -> gameId
  const gameIdMapping = buildGameIdMapping(myLudoCsvContent);

  // Télécharger ou lire le fichier des mouvements
  const csvContent = await fetchCsvContent(csvFile);
  const desiredLoans = parseCSV(csvContent, gameIdMapping);

  const borrowed = desiredLoans.filter(l => l.status === 'borrowed');
  const returned = desiredLoans.filter(l => l.status === 'returned');
  console.log(`  ${borrowed.length} actif(s), ${returned.length} retourne(s)\n`);

  const csrfToken = await getCsrfToken(cookies);

  let created = 0;
  let deleted = 0;
  let errors = 0;

  for (const loan of desiredLoans) {
    const { gameId, codeJeu, dateStart, dateEnd, status } = loan;

    try {
      const existingLoans = await getExistingLoans(gameId, cookies, csrfToken);

      if (status === 'borrowed') {
        const activeLoans = existingLoans.filter(l => !l.returned || (l.comment && l.comment.includes('Sync CSV')));

        if (activeLoans.length === 0) {
          const success = await createLoan(gameId, dateStart, dateEnd, cookies, csrfToken);
          if (success) {
            console.log(`✓ Cree: ${codeJeu} (${dateStart})`);
            created++;
          } else {
            console.log(`✗ Echec creation: ${codeJeu}`);
            errors++;
          }
        }
      } else {
        // Status returned
        let deletedCount = 0;
        for (const existingLoan of existingLoans) {
          const isActive = !existingLoan.returned || (existingLoan.comment && existingLoan.comment.includes('Sync CSV'));
          if (isActive) {
            const success = await deleteLoan(gameId, existingLoan.id, cookies, csrfToken);
            if (success) {
              deletedCount++;
              deleted++;
            } else {
              errors++;
            }
          }
        }
        if (deletedCount > 0) {
          console.log(`✓ Supprime: ${codeJeu} (${deletedCount} emprunt(s))`);
        }
      }

      await new Promise(resolve => {
        setTimeout(resolve, 500);
      });

    } catch (error) {
      console.error(`✗ Erreur ${codeJeu}: ${error.message}`);
      errors++;
    }
  }

  console.log('\n=== Resume ===');
  console.log(`Crees: ${created} | Supprimes: ${deleted} | Erreurs: ${errors}`);
  console.log('Synchronisation terminee\n');
}

// ============================================
// PARSING CSV
// ============================================

function buildGameIdMapping(csvContent) {
  // Supprimer le BOM UTF-8 si présent
  let content = csvContent;
  if (content.charCodeAt(0) === 0xFEFF) {
    content = content.substring(1);
  }

  // Supprimer l'apostrophe au début de la première ligne si présente
  if (content.startsWith("'")) {
    content = content.substring(1);
  }

  // Parser le CSV avec csv-parse
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    delimiter: ';',
    relax_column_count: true
  });

  // Créer un mapping CodeJeu (Emplacement) -> gameId (ID)
  const mapping = {};
  for (const record of records) {
    const emplacement = record['Emplacement'];
    const gameId = record['ID'];

    if (emplacement && gameId) {
      mapping[emplacement] = gameId;
    }
  }

  console.log(`✓ ${Object.keys(mapping).length} jeu(x) mappe(s)`);
  return mapping;
}

function parseCSV(csvContent, gameIdMapping) {
  // Parser le CSV avec csv-parse
  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    delimiter: ';'
  });

  const loans = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let mappedCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < records.length; i++) {
    const record = records[i];

    const codeJeu = record['CodeJeu'];
    const dateSortie = record['DateSortie'];
    const dateRetour = record['DateRetour'];

    if (!codeJeu || !dateSortie) {
      skippedCount++;
      continue;
    }

    // Ignorer les puzzles
    if (codeJeu.toLowerCase() === 'puzzle') {
      skippedCount++;
      continue;
    }

    // Mapper CodeJeu -> gameId via l'emplacement
    const gameId = gameIdMapping[codeJeu];
    if (!gameId) {
      // Ignorer les jeux sans mapping
      skippedCount++;
      continue;
    }

    mappedCount++;

    // Convertir les dates du format DD/MM/YYYY vers YYYY-MM-DD
    const convertDate = (dateStr) => {
      if (!dateStr) {return '';}
      const parts = dateStr.split('/');
      if (parts.length === 3) {
        return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
      }
      return dateStr;
    };

    const dateStart = convertDate(dateSortie);
    const dateEnd = dateRetour ? convertDate(dateRetour) : '';

    let status = 'borrowed';
    if (dateEnd) {
      const dateEndObj = new Date(dateEnd);
      dateEndObj.setHours(0, 0, 0, 0);
      if (dateEndObj <= today) {
        status = 'returned';
      } else {
        status = 'borrowed';
      }
    }

    loans.push({
      gameId,
      codeJeu,
      dateStart,
      dateEnd,
      status
    });
  }

  console.log(`✓ ${mappedCount} emprunt(s) a synchroniser (${skippedCount} ignores)`);

  return loans;
}

// ============================================
// AUTHENTIFICATION API MYLUDO
// ============================================

async function loadCookies() {
  let cookies = {};

  await refreshCookies();

  if (fs.existsSync('cookies-http.json')) {
    cookies = JSON.parse(fs.readFileSync('cookies-http.json', 'utf8'));
  } else {
    throw new Error('Echec de la recuperation des cookies');
  }
  if (!areCookiesValid(cookies)) {
    throw new Error('Les cookies recuperes sont invalides. Verifiez vos identifiants dans getCookiesHttp.js');
  }

  console.log('✓ Authentification reussie');
  return cookies;
}

async function refreshCookies() {
  try {
    await getCookies();
    await new Promise(resolve => {
      setTimeout(resolve, 1000);
    });
    return true;
  } catch {
    console.error('Erreur lors de la recuperation des cookies');
    throw new Error('Impossible de recuperer les cookies. Verifiez getCookiesHttp.js');
  }
}

function areCookiesValid(cookies) {
  return !!(cookies.MYLUDO_UID && cookies.MYLUDO_TOK);
}

async function getCsrfToken(cookies) {
  const homeResponse = await makeRequest('https://www.myludo.fr/', {
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'fr,fr-FR;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Cookie': cookiesToString(cookies)
    }
  });

  const csrfToken = extractCsrfToken(homeResponse.body);
  if (!csrfToken) {
    throw new Error('Token CSRF introuvable');
  }
  return csrfToken;
}

// ============================================
// API MYLUDO
// ============================================

async function getExistingLoans(gameId, cookies, csrfToken) {
  const timestamp = Date.now();
  const loansUrl = `https://www.myludo.fr/views/game/datas.php?type=loans&id=${gameId}&page=1&limit=&family=&filter=&department=&pro=&location=&datefrom=&dateto=&stakes=&online=&order=bydatedesc&_=${timestamp}`;

  const response = await makeRequest(loansUrl, {
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0',
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'Accept-Language': 'fr,fr-FR;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br',
      'Referer': 'https://www.myludo.fr/',
      'X-Csrf-Token': csrfToken,
      'X-Requested-With': 'XMLHttpRequest',
      'Cookie': cookiesToString(cookies)
    }
  });

  if (response.statusCode === 200) {
    const data = JSON.parse(response.body);
    return data.list || [];
  }
  return [];
}

async function createLoan(gameId, dateStart, dateEnd, cookies, csrfToken) {
  const boundary = 'geckoformboundary9cca565976bb2f2d84a09eda68344620';
  const formData = {
    game: gameId,
    index: 0,
    datestart: dateStart,
    dateend: dateEnd || '',
    borrower: '',
    comment: 'Sync CSV',
    datereturned: '',
    type: 'save'
  };

  const body = createMultipartBody(formData, boundary);

  const response = await makeRequest('https://www.myludo.fr/views/loans/datas.php', {
    method: 'POST',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0',
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'Accept-Language': 'fr,fr-FR;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br',
      'Content-Type': `multipart/form-data; boundary=----${boundary}`,
      'Referer': 'https://www.myludo.fr/',
      'X-Csrf-Token': csrfToken,
      'X-Requested-With': 'XMLHttpRequest',
      'Origin': 'https://www.myludo.fr',
      'Cookie': cookiesToString(cookies),
      'Content-Length': Buffer.byteLength(body)
    },
    body: body
  });

  if (response.statusCode === 200) {
    const data = JSON.parse(response.body);
    return data.success;
  }
  return false;
}

async function deleteLoan(gameId, loanId, cookies, csrfToken) {
  const timestamp = Date.now();
  const deleteUrl = `https://www.myludo.fr/views/loans/datas.php?type=delete&id=${loanId}&game=${gameId}&_=${timestamp}`;

  const response = await makeRequest(deleteUrl, {
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0',
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'Accept-Language': 'fr,fr-FR;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br',
      'Referer': 'https://www.myludo.fr/',
      'X-Csrf-Token': csrfToken,
      'X-Requested-With': 'XMLHttpRequest',
      'Cookie': cookiesToString(cookies)
    }
  });

  if (response.statusCode === 200) {
    const data = JSON.parse(response.body);
    return data.success;
  }
  return false;
}

const csvFile = process.argv[2] || 'data/tblMouvements_saison.csv';
const myLudoCsvFile = process.argv[3] || 'data/Export_my_ludo.csv';

syncLoans(csvFile, myLudoCsvFile)
  .then(() => {
    process.exit(0);
  })
  .catch(async (error) => {
    console.error('\n✗ Erreur fatale:', error.message);
    await sendErrorEmail(error, csvFile);
    process.exit(1);
  });
