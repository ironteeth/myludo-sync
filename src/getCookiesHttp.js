const https = require('https');
const http = require('http');
const { URL } = require('url');
const zlib = require('zlib');

function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const client = isHttps ? https : http;

    const requestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {},
      ...options
    };

    const req = client.request(requestOptions, (res) => {
      // Gérer la décompression en fonction de l'encodage
      let stream = res;
      const encoding = res.headers['content-encoding'];

      if (encoding === 'gzip') {
        stream = res.pipe(zlib.createGunzip());
      } else if (encoding === 'deflate') {
        stream = res.pipe(zlib.createInflate());
      } else if (encoding === 'br') {
        stream = res.pipe(zlib.createBrotliDecompress());
      }

      let data = '';

      stream.on('data', (chunk) => {
        data += chunk;
      });

      stream.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data,
          cookies: parseCookies(res.headers['set-cookie'] || [])
        });
      });

      stream.on('error', (error) => {
        reject(error);
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    if (options.body) {
      req.write(options.body);
    }

    req.end();
  });
}

function parseCookies(setCookieHeaders) {
  const cookies = {};

  setCookieHeaders.forEach(cookieStr => {
    const parts = cookieStr.split(';')[0].split('=');
    const name = parts[0].trim();
    cookies[name] = parts.slice(1).join('=').trim();
  });

  return cookies;
}


function cookiesToString(cookies) {
  return Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

function createMultipartBody(fields, boundary) {
  let body = '';

  for (const [name, value] of Object.entries(fields)) {
    body += `------${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="${name}"\r\n\r\n`;
    body += `${value}\r\n`;
  }

  body += `------${boundary}--\r\n`;

  return body;
}

function extractCsrfToken(html) {
  // Chercher le token dans différents formats possibles
  const patterns = [
    /csrf[_-]?token["']?\s*[:=]\s*["']([^"']+)["']/i,
    /name=["']csrf[_-]?token["']\s+value=["']([^"']+)["']/i,
    /value=["']([^"']+)["']\s+name=["']csrf[_-]?token["']/i,
    /<meta[^>]*name=["']csrf-token["'][^>]*content=["']([^"']+)["']/i,
    /X-Csrf-Token["']?\s*:\s*["']([^"']+)["']/i,
    /csrfToken\s*[:=]\s*["']([^"']+)["']/i,
    /_token["']?\s*[:=]\s*["']([^"']+)["']/i,
    /data-csrf=["']([^"']+)["']/i
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      return match[1];
    }
  }

  // Chercher dans les scripts JavaScript
  const scriptTokenMatch = html.match(/var\s+\w*[Tt]oken\w*\s*=\s*["']([^"']+)["']/);
  if (scriptTokenMatch) {
    return scriptTokenMatch[1];
  }

  return null;
}

async function getCookies() {
  try {
    // Première requête pour obtenir les cookies initiaux et le token CSRF
    const initialResponse = await makeRequest('https://www.myludo.fr/', {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'fr,fr-FR;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      }
    });

    // Extraire le token CSRF
    const csrfToken = extractCsrfToken(initialResponse.body);

    // Préparer les cookies pour la requête de login
    let allCookies = { ...initialResponse.cookies };


    // Boundary pour multipart/form-data
    const boundary = 'geckoformboundaryb327f30fb99c7f69f1cc1215b61b1397';

    // Données du formulaire
    const formData = {
      'type': 'login',
      'email': process.env.MYLUDO_EMAIL,
      'password': process.env.MYLUDO_PASSWORD,
      'persistant': '1'
    };

    // Vérifier que les variables d'environnement sont définies
    if (!formData.email || !formData.password) {
      throw new Error('Les variables d\'environnement MYLUDO_EMAIL et MYLUDO_PASSWORD doivent être définies');
    }

    const body = createMultipartBody(formData, boundary);

    // Headers pour la requête de login
    const loginHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0',
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'Accept-Language': 'fr,fr-FR;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br, zstd',
      'Content-Type': `multipart/form-data; boundary=----${boundary}`,
      'Referer': 'https://www.myludo.fr/',
      'X-Requested-With': 'XMLHttpRequest',
      'Origin': 'https://www.myludo.fr',
      'Connection': 'keep-alive',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
      'Content-Length': Buffer.byteLength(body)
    };

    // Ajouter le token CSRF si trouvé
    if (csrfToken) {
      loginHeaders['X-Csrf-Token'] = csrfToken;
    }

    // Ajouter les cookies
    if (Object.keys(allCookies).length > 0) {
      loginHeaders['Cookie'] = cookiesToString(allCookies);
    }

    // Requête de login
    const loginResponse = await makeRequest('https://www.myludo.fr/views/login/datas.php', {
      method: 'POST',
      headers: loginHeaders,
      body: body
    });

    // Fusionner tous les cookies
    allCookies = { ...allCookies, ...loginResponse.cookies };

    // Sauvegarder dans un fichier
    const fs = require('fs');
    fs.writeFileSync('cookies-http.json', JSON.stringify(allCookies, null, 2));

    return allCookies;

  } catch (error) {
    console.error('Erreur:', error);
    throw error;
  }
}

// Exporter la fonction pour être utilisée comme module
module.exports = { getCookies };

// N'exécuter automatiquement que si le script est lancé directement
if (require.main === module) {
  getCookies()
    .then(() => {
      console.log('\n✓ Script terminé');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n✗ Erreur:', error.message);
      process.exit(1);
    });
}
