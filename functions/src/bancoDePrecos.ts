/**
 * Integração com a API do Banco de Preços (BP4).
 *
 * O UsuarioApiToken é um SEGREDO (Firebase Secret `BANCO_PRECOS_TOKEN`) e NUNCA
 * vai ao navegador. Estas Cloud Functions atuam como proxy: trocam o token por
 * um JWT (cacheado por instância quente) e expõem ao front só leitura das
 * cotações já existentes na conta — para preencher o banco de itens do LIE.
 *
 * Fluxo BP4:
 *   POST /api/bp4/Auth/CreateUserToken  { usuarioApiToken }            -> { token (JWT) }
 *   GET  /api/bp4/Cotacoes/GetCotacoes                                 -> { content: [...] }
 *   GET  /api/bp4/Cotacoes/GetCotacaoCompleta        body {idCotacao}  -> { cotacao, lotes, itens }
 *   GET  /api/bp4/Cotacoes/GetCotacoesPrecosItens    body {idCotacao,idItem} -> [precos]
 *
 * Obs.: a BP usa GET com BODY JSON — o fetch do Node (undici) proíbe body em GET,
 * por isso usamos o módulo `https` nativo.
 */
import * as functions from 'firebase-functions';
import * as https from 'https';

const BP_HOST = 'api.bancodeprecos.com.br';

// ── CORS: reflete apenas origens conhecidas do LIE ──────────────────────────
const ALLOWED_ORIGIN = [
  /^https:\/\/([a-z0-9-]+\.)?lie\.com\.br$/i,
  /^https:\/\/lie-projetos(-[a-z]+)?\.(web\.app|firebaseapp\.com)$/i,
  /^http:\/\/localhost(:\d+)?$/i,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/i,
];
function setCors(req: functions.https.Request, res: functions.Response) {
  const origin = String(req.headers.origin || '');
  if (ALLOWED_ORIGIN.some(r => r.test(origin))) res.set('Access-Control-Allow-Origin', origin);
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.set('Vary', 'Origin');
}

// ── HTTP helper que aceita GET com body (exigência da BP4) ──────────────────
function bpRequest(method: string, path: string, jwt: string | null, body?: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined && body !== null ? JSON.stringify(body) : null;
    const req = https.request(
      {
        hostname: BP_HOST,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (resp) => {
        let data = '';
        resp.on('data', (c) => (data += c));
        resp.on('end', () => {
          const status = resp.statusCode || 0;
          if (status >= 400) {
            reject(new Error(`BP ${method} ${path} -> HTTP ${status}: ${data.slice(0, 200)}`));
            return;
          }
          try { resolve(data ? JSON.parse(data) : null); }
          catch { resolve(data); }
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ── JWT cache por instância quente ──────────────────────────────────────────
let jwtCache: { token: string; exp: number } | null = null;
async function getJwt(): Promise<string> {
  const now = Date.now();
  if (jwtCache && jwtCache.exp > now + 60_000) return jwtCache.token;

  const apiToken = process.env.BANCO_PRECOS_TOKEN;
  if (!apiToken) throw new Error('BANCO_PRECOS_TOKEN não configurado no Secret Manager.');

  const resp = await bpRequest('POST', '/api/bp4/Auth/CreateUserToken', null, { usuarioApiToken: apiToken });
  const token = resp && resp.token;
  if (!token) throw new Error('Banco de Preços não retornou JWT (token inválido/revogado?).');

  // Lê o exp do payload do JWT pra cachear até pouco antes de expirar.
  let exp = now + 25 * 60 * 1000;
  try {
    const p = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
    if (p.exp) exp = p.exp * 1000;
  } catch { /* usa o default */ }

  jwtCache = { token, exp };
  return token;
}

// Wrapper comum das 3 functions (CORS + erro padronizado).
function handler(run: (body: any) => Promise<any>) {
  return functions
    .runWith({ timeoutSeconds: 60, memory: '256MB', secrets: ['BANCO_PRECOS_TOKEN'] })
    .https.onRequest(async (req, res) => {
      setCors(req, res);
      if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
      if (req.method !== 'POST') { res.status(405).json({ error: 'Use POST.' }); return; }
      try {
        const out = await run(req.body || {});
        res.status(200).json(out);
      } catch (e: any) {
        console.error('[bancoDePrecos]', e?.message || e);
        res.status(502).json({ error: e?.message || 'Falha na integração com o Banco de Preços.' });
      }
    });
}

/** Lista as cotações existentes na conta (para o operador escolher). */
export const bancoPrecosCotacoes = handler(async () => {
  const jwt = await getJwt();
  const r = await bpRequest('GET', '/api/bp4/Cotacoes/GetCotacoes', jwt);
  const content = (r && (r.content || r)) || [];
  // Devolve só o necessário pra UI (lista enxuta).
  const cotacoes = (Array.isArray(content) ? content : []).map((c: any) => ({
    idCotacao: c.idCotacao,
    descricao: c.descricao,
    finalidade: c.finalidade,
    quantidadeItens: c.quantidadeItens,
    dataAbertura: c.dataAbertura,
    finalizada: c.cotacaoFinalizada === 1 || c.cotacaoFinalizada === true,
  }));
  return { cotacoes };
});

/** Itens (com nome/descrição e countPrecos) de uma cotação. */
export const bancoPrecosCotacaoItens = handler(async (body) => {
  const idCotacao = Number(body.idCotacao);
  if (!idCotacao) throw new Error('idCotacao obrigatório.');
  const jwt = await getJwt();
  const r = await bpRequest('GET', '/api/bp4/Cotacoes/GetCotacaoCompleta', jwt, { idCotacao });
  const c = (r && (r.content || r)) || {};
  const itens = (c.itens || c.cotacaoItens || []).map((it: any) => ({
    idItem: it.idItem,
    nome: it.nomeItem || it.nome,
    descricao: it.descricao,
    codigo: it.codigo,
    nomeLote: it.nomeLote,
    countPrecos: it.countPrecos || 0,
    unidade: it.siglaUnidade || it.nomeUnidadeMedida,
  }));
  return { cotacao: c.cotacao || null, itens };
});

/** Preços pesquisados de um item da cotação (vira referência no LIE). */
export const bancoPrecosItemPrecos = handler(async (body) => {
  const idCotacao = Number(body.idCotacao);
  const idItem = Number(body.idItem);
  if (!idCotacao || !idItem) throw new Error('idCotacao e idItem obrigatórios.');
  const jwt = await getJwt();
  const r = await bpRequest('GET', '/api/bp4/Cotacoes/GetCotacoesPrecosItens', jwt, { idCotacao, idItem });
  const precos = (r && (r.content || r.precos || r)) || [];
  return { precos: Array.isArray(precos) ? precos : [] };
});
