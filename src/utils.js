const https = require('https');
const http = require('http');
const { URL } = require('url');
const zlib = require('zlib');
const fs = require('fs');
const fsPromises = require('fs').promises;

// ============================================
// UTILITAIRES HTTP
// ============================================

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
      stream.on('data', (chunk) => { data += chunk; });
      stream.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
      stream.on('error', (error) => { reject(error); });
    });

    req.on('error', (error) => { reject(error); });
    if (options.body) {req.write(options.body);}
    req.end();
  });
}

function cookiesToString(cookies) {
  return Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join('; ');
}

function extractCsrfToken(html) {
  const patterns = [
    /<meta[^>]*name=["']csrf-token["'][^>]*content=["']([^"']+)["']/i,
    /csrf[_-]?token["']?\s*[:=]\s*["']([^"']+)["']/i,
    /X-Csrf-Token["']?\s*:\s*["']([^"']+)["']/i
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {return match[1];}
  }
  return null;
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

// ============================================
// TÉLÉCHARGEMENT DE FICHIERS
// ============================================

function isUrl(str) {
  try {
    const url = new URL(str);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

async function downloadFile(url, cookies = null) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:148.0) Gecko/20100101 Firefox/148.0',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'fr,fr-FR;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive'
  };

  if (cookies) {
    headers['Cookie'] = cookiesToString(cookies);
    headers['Referer'] = 'https://www.myludo.fr/';
  }

  const response = await makeRequest(url, {
    method: 'GET',
    headers
  });

  if (response.statusCode !== 200) {
    throw new Error(`Echec du telechargement: HTTP ${response.statusCode}`);
  }

  return response.body;
}

function fetchCsvContent(filePathOrUrl, cookies = null) {
  if (isUrl(filePathOrUrl)) {
    console.log(`  Telechargement depuis: ${filePathOrUrl}`);
    return downloadFile(filePathOrUrl, cookies);
  }
  if (!fs.existsSync(filePathOrUrl)) {
    throw new Error(`Fichier CSV introuvable: ${filePathOrUrl}`);
  }
  return fsPromises.readFile(filePathOrUrl, 'utf8');
}

// ============================================
// GESTION DES ERREURS
// ============================================

async function sendErrorEmail(error, csvFile) {
  const nodemailer = require('nodemailer');

  try {
    if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD || !process.env.EMAIL_TO) {
      console.warn('Variables d\'environnement email non configurées. Email d\'erreur non envoyé.');
      return;
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
      }
    });

    const mailOptions = {
      from: process.env.GMAIL_USER,
      to: process.env.EMAIL_TO,
      subject: '[MyLudo Sync] Erreur lors de la synchronisation',
      text: `Une erreur est survenue lors de la synchronisation MyLudo.

Fichier CSV: ${csvFile}
Date: ${new Date().toLocaleString('fr-FR')}

Erreur:
${error.message}

Stack trace:
${error.stack}
`,
      html: `<h2>Erreur lors de la synchronisation MyLudo</h2>
<p><strong>Fichier CSV:</strong> ${csvFile}</p>
<p><strong>Date:</strong> ${new Date().toLocaleString('fr-FR')}</p>
<h3>Erreur:</h3>
<pre>${error.message}</pre>
<h3>Stack trace:</h3>
<pre>${error.stack}</pre>
`
    };

    await transporter.sendMail(mailOptions);
    console.log(`Email d'erreur envoye a ${process.env.EMAIL_TO}`);
  } catch (emailError) {
    console.error('Impossible d\'envoyer l\'email d\'erreur:', emailError.message);
  }
}

module.exports = {
  makeRequest,
  cookiesToString,
  extractCsrfToken,
  createMultipartBody,
  sendErrorEmail,
  isUrl,
  fetchCsvContent
};

