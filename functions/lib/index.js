"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.downloadStorageFile = exports.obterPdfContratacaoPublica = void 0;
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const puppeteer = require("puppeteer");
admin.initializeApp();
exports.obterPdfContratacaoPublica = functions
    .runWith({ timeoutSeconds: 300, memory: '1GB' })
    .https.onCall(async (data, context) => {
    const { url, token } = data;
    if (!url) {
        throw new functions.https.HttpsError('invalid-argument', 'A URL é obrigatória.');
    }
    const storageBucket = admin.storage().bucket();
    const cachePath = `public_quote_pdfs/${token || 'temp_' + Date.now()}.pdf`;
    const file = storageBucket.file(cachePath);
    // 1. Verificar se o arquivo já existe no cache para reuso instantâneo
    try {
        const [exists] = await file.exists();
        if (exists) {
            const [downloadUrl] = await file.getSignedUrl({
                action: 'read',
                expires: '03-01-2500',
            });
            return { downloadUrl };
        }
    }
    catch (e) {
        console.warn('Erro ao verificar cache no Storage:', e);
    }
    // 2. Iniciar Puppeteer para capturar a página e convertê-la em PDF
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1200, height: 800 });
        // Abre a página governamental da Ata ou Edital
        const response = await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        const status = response ? response.status() : 200;
        if (status >= 400) {
            throw new Error(`O servidor governamental respondeu com status HTTP ${status}.`);
        }
        // Otimização: Forçar quebras de linha limpas para impressão
        await page.addStyleTag({
            content: `
          @media print {
            body { background: white; color: black; }
            a { text-decoration: underline !important; color: black !important; }
            .no-print, header, footer, nav, #menu { display: none !important; }
          }
        `
        });
        // Gerar PDF da página
        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '12mm', right: '12mm', bottom: '12mm', left: '12mm' },
        });
        // Salvar PDF gerado no Firebase Storage cache
        await file.save(pdfBuffer, {
            metadata: {
                contentType: 'application/pdf',
                cacheControl: 'public, max-age=31536000',
            },
        });
        // Obter URL pública de download
        const [downloadUrl] = await file.getSignedUrl({
            action: 'read',
            expires: '03-01-2500',
        });
        return { downloadUrl };
    }
    catch (error) {
        console.error('Erro ao gerar PDF da contratação pública:', error);
        throw new functions.https.HttpsError('internal', 'Erro ao renderizar a página governamental: ' + error.message);
    }
    finally {
        await browser.close();
    }
});
/**
 * Proxy de download para arquivos do Firebase Storage.
 *
 * Por quê: o bucket lie-projetos.firebasestorage.app não tem CORS
 * configurado, e o frontend (projetos.lie.com.br) precisa baixar PDFs
 * e imagens pra montar o PDF consolidado. Tentamos gsutil cors set,
 * mas é setup manual que não foi feito. Em vez disso, esta function
 * baixa o arquivo via Admin SDK (zero CORS no server) e retorna o
 * binário com headers CORS abertos pro nosso domínio.
 *
 * Uso:
 *   GET https://us-central1-lie-projetos.cloudfunctions.net/downloadStorageFile?path=entities/abc/doc.pdf
 *
 * Segurança: aceita apenas paths que começam com pastas conhecidas
 * (entities/, logos/, projects/, public_quote_pdfs/) pra evitar
 * exposição arbitrária de arquivos do bucket.
 */
const ALLOWED_PATH_PREFIXES = [
    'entities/',
    'logos/',
    'projects/',
    'public_quote_pdfs/',
];
const ALLOWED_ORIGINS = [
    'https://projetos.lie.com.br',
    'https://lie-projetos.web.app',
    'https://lie-projetos.firebaseapp.com',
    'http://localhost:5173',
    'http://localhost:5000',
    'http://127.0.0.1:5173',
];
function pickAllowedOrigin(reqOrigin) {
    if (reqOrigin && ALLOWED_ORIGINS.includes(reqOrigin))
        return reqOrigin;
    // Em produção retornamos o domínio principal (não wildcard) pra
    // permitir credenciais futuras se necessário.
    return ALLOWED_ORIGINS[0];
}
exports.downloadStorageFile = functions
    .runWith({ timeoutSeconds: 60, memory: '512MB' })
    .https.onRequest(async (req, res) => {
    const origin = pickAllowedOrigin(req.headers.origin);
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Vary', 'Origin');
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    if (req.method !== 'GET') {
        res.status(405).json({ error: 'Apenas GET é suportado.' });
        return;
    }
    let path = String(req.query.path || '').trim();
    if (!path) {
        res.status(400).json({ error: 'Query param "path" é obrigatório.' });
        return;
    }
    // Aceita também URLs completas do Storage — extrai o path interno.
    const urlMatch = path.match(/\/o\/([^?]+)/);
    if (urlMatch) {
        path = decodeURIComponent(urlMatch[1]);
    }
    // Segurança: só serve de pastas conhecidas.
    const allowed = ALLOWED_PATH_PREFIXES.some(p => path.startsWith(p));
    if (!allowed) {
        res.status(403).json({
            error: 'Path não permitido. Aceitos: ' + ALLOWED_PATH_PREFIXES.join(', '),
        });
        return;
    }
    try {
        const file = admin.storage().bucket().file(path);
        const [exists] = await file.exists();
        if (!exists) {
            res.status(404).json({ error: 'Arquivo não encontrado: ' + path });
            return;
        }
        const [metadata] = await file.getMetadata();
        const contentType = metadata.contentType || 'application/octet-stream';
        const size = metadata.size ? Number(metadata.size) : undefined;
        res.set('Content-Type', contentType);
        if (size)
            res.set('Content-Length', String(size));
        // Cache 1h no browser + CDN (arquivos do Storage raramente mudam).
        res.set('Cache-Control', 'public, max-age=3600');
        file.createReadStream()
            .on('error', (err) => {
            console.error('Erro no stream do arquivo:', path, err);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Erro ao ler arquivo: ' + err.message });
            }
            else {
                res.end();
            }
        })
            .pipe(res);
    }
    catch (e) {
        console.error('Erro ao servir arquivo:', path, e);
        res.status(500).json({ error: 'Erro interno: ' + (e?.message || e) });
    }
});
//# sourceMappingURL=index.js.map