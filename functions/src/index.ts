import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import * as puppeteer from 'puppeteer';

admin.initializeApp();

export const obterPdfContratacaoPublica = functions
  .runWith({ timeoutSeconds: 300, memory: '1GB' })
  .https.onCall(async (data: any, context: functions.https.CallableContext) => {
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
    } catch (e) {
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
    } catch (error: any) {
      console.error('Erro ao gerar PDF da contratação pública:', error);
      throw new functions.https.HttpsError('internal', 'Erro ao renderizar a página governamental: ' + error.message);
    } finally {
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

function pickAllowedOrigin(reqOrigin: string | undefined): string {
  if (reqOrigin && ALLOWED_ORIGINS.includes(reqOrigin)) return reqOrigin;
  // Em produção retornamos o domínio principal (não wildcard) pra
  // permitir credenciais futuras se necessário.
  return ALLOWED_ORIGINS[0];
}

export const downloadStorageFile = functions
  .runWith({ timeoutSeconds: 60, memory: '512MB' })
  .https.onRequest(async (req, res) => {
    const origin = pickAllowedOrigin(req.headers.origin as string | undefined);
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
      if (size) res.set('Content-Length', String(size));
      // Cache 1h no browser + CDN (arquivos do Storage raramente mudam).
      res.set('Cache-Control', 'public, max-age=3600');

      file.createReadStream()
        .on('error', (err) => {
          console.error('Erro no stream do arquivo:', path, err);
          if (!res.headersSent) {
            res.status(500).json({ error: 'Erro ao ler arquivo: ' + err.message });
          } else {
            res.end();
          }
        })
        .pipe(res);
    } catch (e: any) {
      console.error('Erro ao servir arquivo:', path, e);
      res.status(500).json({ error: 'Erro interno: ' + (e?.message || e) });
    }
  });

/**
 * Pesquisa multi-fonte de preços públicos por código CATMAT/CATSER.
 *
 * Consulta em paralelo 3 endpoints do dadosabertos.compras.gov.br:
 *   - /modulo-pesquisa-preco/1_consultarMaterial            (preços praticados — base histórica)
 *   - /modulo-contratacoes/2_consultarItensContratacoes_PNCP_14133 (contratações Lei 14.133/2021)
 *   - /modulo-arp/2_consultarARPItem                        (atas de registro de preço PNCP)
 *
 * Normaliza tudo num formato comum e adiciona `linkPublico` rastreável
 * apontando pro PNCP (https://pncp.gov.br/app/{editais|atas|contratos}/...)
 * quando o numeroControlePNCP estiver disponível.
 *
 * Uso:
 *   GET https://us-central1-lie-projetos.cloudfunctions.net/consultarPrecosMulti?codigoItemCatalogo=601221
 */
export const consultarPrecosMulti = functions
  .runWith({ timeoutSeconds: 90, memory: '512MB' })
  .https.onRequest(async (req, res) => {
    const origin = pickAllowedOrigin(req.headers.origin as string | undefined);
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Vary', 'Origin');

    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'GET') { res.status(405).json({ error: 'Apenas GET é suportado.' }); return; }

    const codigoItemCatalogo = String(req.query.codigoItemCatalogo || '').trim();
    if (!codigoItemCatalogo || !/^\d+$/.test(codigoItemCatalogo)) {
      res.status(400).json({ error: 'Query param "codigoItemCatalogo" obrigatório e numérico.' });
      return;
    }
    const descricao = String(req.query.descricao || '').trim();

    const tamanhoPagina = String(req.query.tamanhoPagina || '500');
    const base = 'https://dadosabertos.compras.gov.br';
    const headers = {
      'Accept': 'application/json',
      'User-Agent': 'LIE-Projetos/1.0 (+https://projetos.lie.com.br)'
    };

    const fontes: { nome: string; url: string; tipo: 'compras' | 'tce-pe' }[] = [
      {
        nome: 'compras.gov.br',
        url: `${base}/modulo-pesquisa-preco/1_consultarMaterial?pagina=1&tamanhoPagina=${tamanhoPagina}&codigoItemCatalogo=${codigoItemCatalogo}`,
        tipo: 'compras'
      },
      {
        nome: 'pncp-contratacao',
        url: `${base}/modulo-contratacoes/2_consultarItensContratacoes_PNCP_14133?pagina=1&tamanhoPagina=${tamanhoPagina}&codigoItemCatalogo=${codigoItemCatalogo}`,
        tipo: 'compras'
      },
      {
        nome: 'pncp-ata',
        url: `${base}/modulo-arp/2_consultarARPItem?pagina=1&tamanhoPagina=${tamanhoPagina}&codigoItemCatalogo=${codigoItemCatalogo}`,
        tipo: 'compras'
      }
    ];

    // TCE-PE: única API estadual viável que aceita filtro por descrição textual.
    // Adicionada apenas quando o frontend passa a descricao do item.
    if (descricao && descricao.length >= 3) {
      fontes.push({
        nome: 'tce-pe',
        url: `https://sistemas.tce.pe.gov.br/DadosAbertos/ContratoItemObjeto!json?Descricao=${encodeURIComponent(descricao)}`,
        tipo: 'tce-pe'
      });
    }

    const montarLinkPncp = (numeroControle: string | undefined, tipo: 'editais' | 'atas' | 'contratos'): string | undefined => {
      if (!numeroControle) return undefined;
      // Formato esperado: {CNPJ}-1-{sequencial}/{ano}
      const m = numeroControle.match(/^(\d{14})-[\dA-Z]+-(\d+)\/(\d{4})$/);
      if (!m) return undefined;
      const [, cnpj, seq, ano] = m;
      return `https://pncp.gov.br/app/${tipo}/${cnpj}/${ano}/${seq}`;
    };

    const normalizar = (r: any, fonteNome: string): any => {
      // TCE-PE: estrutura própria, sem órgão/data, link via ContratoOriginal
      if (fonteNome === 'tce-pe') {
        const codContrato = r.CodigoContratoOriginal || '';
        const linkContrato = codContrato
          ? `https://sistemas.tce.pe.gov.br/DadosAbertos/Contratos!json?CodigoContratoOriginal=${encodeURIComponent(codContrato)}`
          : 'https://sistemas.tce.pe.gov.br/DadosAbertos/';
        return {
          fonte: fonteNome,
          orgaoLicitante: 'TCE-PE (Contrato Estadual)',
          uasg: '',
          cnpjOrgao: '',
          identificadorCompra: codContrato || r.CodigoItem || '',
          numeroControlePNCP: '',
          dataHomologacao: '',
          quantidade: Number(r.Quantidade) || 0,
          unidadeMedida: r.Unidade || '',
          descricaoItem: r.Descricao || '',
          valorUnitario: Number(r.PrecoUnitario) || 0,
          localizacaoUrl: linkContrato
        };
      }

      const numeroControle = r.numeroControlePNCP || r.numeroControlePNCPCompra || r.numeroControlePNCPAta;
      const tipoLink: 'editais' | 'atas' | 'contratos' =
        fonteNome === 'pncp-ata' ? 'atas' :
        fonteNome === 'pncp-contratacao' ? 'editais' : 'editais';
      const linkPncp = montarLinkPncp(numeroControle, tipoLink);
      const linkFallback = r.linkProcesso || (r.uasg ? `https://pncp.gov.br/app/contratacoes?q=${r.uasg}` : '');

      return {
        fonte: fonteNome,
        orgaoLicitante: r.orgaoLicitante || r.nomeOrgao || r.razaoSocialOrgao || 'ÓRGÃO PÚBLICO',
        uasg: r.uasg || r.codigoUasg || '',
        cnpjOrgao: r.cnpjOrgao || '',
        identificadorCompra: r.idCompra || r.processo || r.numeroProcesso || r.numeroCompra || r.numeroAta || '',
        numeroControlePNCP: numeroControle || '',
        dataHomologacao: r.dataCompra || r.dataResultado || r.dataPublicacaoPncp || r.dataAssinatura || r.dataAprovacaoAta || '',
        quantidade: Number(r.quantidade) || 0,
        unidadeMedida: r.unidadeMedida || '',
        descricaoItem: r.descricaoItem || r.descricao || '',
        valorUnitario: Number(r.valorUnitario || r.valorUnitarioEstimado || r.valorUnitarioHomologado) || 0,
        localizacaoUrl: linkPncp || linkFallback || ''
      };
    };

    const fetchFonte = async (f: { nome: string; url: string; tipo: 'compras' | 'tce-pe' }) => {
      try {
        const resp = await fetch(f.url, { headers });
        if (!resp.ok) {
          return { fonte: f.nome, ok: false, status: resp.status, registros: [] as any[] };
        }
        const data = await resp.json();
        // TCE-PE devolve array direto; compras.gov.br envelopa em {resultado: [...]}
        const arr = f.tipo === 'tce-pe' ? data : (data.resultado || data.data || data || []);
        const lista = Array.isArray(arr) ? arr : [];
        return {
          fonte: f.nome,
          ok: true,
          status: 200,
          registros: lista.map((r: any) => normalizar(r, f.nome)).filter((r: any) => r.valorUnitario > 0)
        };
      } catch (e: any) {
        return { fonte: f.nome, ok: false, status: 0, erro: e?.message || String(e), registros: [] as any[] };
      }
    };

    const resultados = await Promise.all(fontes.map(fetchFonte));

    const todos = resultados.flatMap(r => r.registros);
    const totaisPorFonte = Object.fromEntries(resultados.map(r => [r.fonte, { ok: r.ok, total: r.registros.length }]));

    // Cache curto pra aliviar API governamental
    res.set('Cache-Control', 'public, max-age=600');
    res.json({
      codigoItemCatalogo,
      total: todos.length,
      totaisPorFonte,
      registros: todos
    });
  });

/**
 * Proxy legado — mantido pra retrocompatibilidade.
 * Usa apenas o endpoint clássico /modulo-pesquisa-preco/1_consultarMaterial.
 * Novos chamadores devem usar `consultarPrecosMulti` (acima).
 */
export const consultarPrecosCompras = functions
  .runWith({ timeoutSeconds: 60, memory: '512MB' })
  .https.onRequest(async (req, res) => {
    const origin = pickAllowedOrigin(req.headers.origin as string | undefined);
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
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

    const codigoItemCatalogo = String(req.query.codigoItemCatalogo || '').trim();
    if (!codigoItemCatalogo || !/^\d+$/.test(codigoItemCatalogo)) {
      res.status(400).json({ error: 'Query param "codigoItemCatalogo" obrigatório e numérico.' });
      return;
    }

    const pagina = String(req.query.pagina || '1');
    const tamanhoPagina = String(req.query.tamanhoPagina || '100');

    const upstreamUrl = `https://dadosabertos.compras.gov.br/modulo-pesquisa-preco/1_consultarMaterial?pagina=${encodeURIComponent(pagina)}&tamanhoPagina=${encodeURIComponent(tamanhoPagina)}&codigoItemCatalogo=${encodeURIComponent(codigoItemCatalogo)}`;

    try {
      const upstreamResp = await fetch(upstreamUrl, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'LIE-Projetos/1.0 (+https://projetos.lie.com.br)'
        }
      });

      const text = await upstreamResp.text();
      // Cache curto no CDN — preços não mudam minuto a minuto
      res.set('Cache-Control', 'public, max-age=600');
      res.status(upstreamResp.status);
      try {
        res.json(JSON.parse(text));
      } catch {
        res.set('Content-Type', upstreamResp.headers.get('content-type') || 'text/plain');
        res.send(text);
      }
    } catch (e: any) {
      console.error('Falha ao consultar API Compras.gov.br:', e);
      res.status(502).json({
        error: 'Falha ao consultar a API pública.',
        detail: e?.message || String(e)
      });
    }
  });
