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
          poder: 'Estadual',
          esfera: '',
          uf: 'PE',
          modalidade: '',
          situacao: '',
          codigoCatalogoItem: '',
          fornecedorNome: '',
          fornecedorCnpj: '',
          identificadorCompra: codContrato || r.CodigoItem || '',
          numeroControlePNCP: '',
          dataHomologacao: '',
          dataVigenciaFinalAta: '',
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

      // Detecta lei aplicada via modalidade/amparo legal
      const modalidadeStr = String(r.nomeModalidadeCompra || r.modalidade || r.modalidadeCompra || '').toLowerCase();
      const amparoStr = String(r.amparoLegalNome || r.amparoLegal || '').toLowerCase();
      const detectarLei = (): string => {
        // Lei 14.133/2021 (Nova Lei de Licitacoes) vs Lei 8.666/93 (Lei Antiga)
        if (amparoStr.includes('14.133') || amparoStr.includes('14133')) return 'Lei 14.133/2021';
        if (amparoStr.includes('8.666') || amparoStr.includes('8666')) return 'Lei 8.666/1993';
        if (amparoStr.includes('10.520') || amparoStr.includes('10520')) return 'Lei 10.520/2002';
        if (amparoStr.includes('13.303') || amparoStr.includes('13303')) return 'Lei 13.303/2016';
        // Heuristica por modalidade quando amparo nao disponivel
        if (modalidadeStr.includes('pregao') && fonteNome === 'pncp-contratacao') return 'Lei 14.133/2021';
        if (modalidadeStr.includes('pregao')) return 'Lei 10.520/2002';
        if (modalidadeStr.includes('dispensa') || modalidadeStr.includes('inexigibilidade')) {
          return fonteNome === 'pncp-contratacao' ? 'Lei 14.133/2021' : 'Lei 8.666/1993';
        }
        return fonteNome === 'pncp-contratacao' || fonteNome === 'pncp-ata' ? 'Lei 14.133/2021' : '';
      };

      return {
        fonte: fonteNome,
        // === Identidade do órgão ===
        orgaoLicitante: r.orgaoLicitante || r.nomeOrgao || r.razaoSocialOrgao || r.orgaoEntidadeNome || r.nomeOrgaoEntidade || 'ÓRGÃO PÚBLICO',
        uasg: r.uasg || r.codigoUasg || r.codigoUnidadeAdministrativa || '',
        cnpjOrgao: r.cnpjOrgao || r.orgaoEntidadeCnpj || r.cnpj || '',
        poder: r.poder || r.orgaoEntidadePoder || '',
        esfera: r.esfera || r.orgaoEntidadeEsfera || '',
        uf: r.uf || r.orgaoEntidadeUfSigla || r.estado || r.siglaUf || '',
        municipio: r.municipio || r.orgaoEntidadeMunicipioNome || r.nomeMunicipio || '',
        // === Legalidade da compra ===
        modalidade: r.nomeModalidadeCompra || r.modalidade || r.modalidadeCompra || r.modalidadeNome || '',
        situacao: r.situacaoCompraItem || r.situacaoCompra || r.situacao || (r.temResultado ? 'Homologado' : ''),
        // NOVOS (GREEN): info juridica adicional do PNCP
        criterioJulgamento: r.criterioJulgamentoNome || r.criterioJulgamento || r.nomeCriterioJulgamento || '',
        modoDisputa: r.modoDisputaNome || r.modoDisputa || r.nomeModoDisputa || '',
        amparoLegal: r.amparoLegalNome || r.amparoLegal || '',
        leiAplicada: detectarLei(),
        objetoCompra: r.objetoCompra || r.objeto || r.descricaoCompra || '',
        // === Identidade do item ===
        codigoCatalogoItem: String(r.codItemCatalogo || r.codigoItemCatalogo || r.codigoItemCatalogoCompra || ''),
        descricaoItem: r.descricaoItemCatalogo || r.descricaoItem || r.descricao || '',
        // === Adjudicatário ===
        fornecedorNome: r.nomeFornecedor || r.razaoSocialFornecedor || r.fornecedorNome || '',
        fornecedorCnpj: r.niFornecedor || r.codFornecedor || r.cnpjFornecedor || r.fornecedorCnpj || '',
        // NOVO (GREEN): inscricao estadual do fornecedor (compliance)
        inscricaoEstadualFornecedor: r.inscricaoEstadualFornecedor || r.ieFornecedor || r.inscricaoEstadual || '',
        // === Identificadores ===
        identificadorCompra: r.idCompra || r.processo || r.numeroProcesso || r.numeroCompra || r.numeroAta || r.numeroAtaRegistroPreco || '',
        numeroControlePNCP: numeroControle || '',
        // === Temporal ===
        dataHomologacao: r.dataCompra || r.dataResultado || r.dataPublicacaoPncp || r.dataAssinatura || r.dataAprovacaoAta || '',
        dataVigenciaFinalAta: r.dataVigenciaFinalAta || r.dataFimVigencia || '',
        // NOVO (GREEN): data de publicacao no PNCP (separada da homologacao)
        dataPublicacao: r.dataPublicacaoPncp || r.dataPublicacao || '',
        // === Escala ===
        quantidade: Number(r.quantidade) || 0,
        unidadeMedida: r.unidadeMedida || r.siglaUnidadeMedida || '',
        valorUnitario: Number(r.valorUnitario || r.valorUnitarioEstimado || r.valorUnitarioHomologado || r.precoUnitario) || 0,
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
 * Busca a lista de arquivos (edital, anexos, ata da sessão) de uma contratação
 * no PNCP a partir do numeroControlePNCP. Permite extrair o link direto pro
 * PDF do edital — diferente do `linkPncpOriginal` que aponta pra pagina de
 * listagem da contratacao.
 *
 * Uso (lazy): o frontend chama isso ao homologar a cesta de cotacoes pra
 * enriquecer cada referencia com `linkEditalPdf` antes de salvar.
 *
 * GET /obterArquivosContratacao?numeroControlePNCP={cnpj}-1-{seq}/{ano}
 *
 * Resposta:
 *  { arquivos: [{ tipo, titulo, url, dataPublicacao }], linkEditalPdf }
 */
export const obterArquivosContratacao = functions
  .runWith({ timeoutSeconds: 30, memory: '256MB' })
  .https.onRequest(async (req, res) => {
    const origin = pickAllowedOrigin(req.headers.origin as string | undefined);
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Vary', 'Origin');

    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'GET') { res.status(405).json({ error: 'Apenas GET é suportado.' }); return; }

    const numeroControle = String(req.query.numeroControlePNCP || '').trim();
    if (!numeroControle) {
      res.status(400).json({ error: 'Query param "numeroControlePNCP" obrigatório.' });
      return;
    }

    // Formato esperado: {CNPJ}-1-{sequencial}/{ano}
    const m = numeroControle.match(/^(\d{14})-[\dA-Z]+-(\d+)\/(\d{4})$/);
    if (!m) {
      res.status(400).json({ error: 'Formato invalido de numeroControlePNCP. Esperado: {cnpj}-1-{seq}/{ano}', recebido: numeroControle });
      return;
    }
    const [, cnpj, seq, ano] = m;

    const headers = {
      'Accept': 'application/json',
      'User-Agent': 'LIE-Projetos/1.0 (+https://projetos.lie.com.br)'
    };

    // PNCP API: lista arquivos da contratacao
    const url = `https://pncp.gov.br/pncp-api/v1/orgaos/${cnpj}/compras/${ano}/${seq}/arquivos`;

    try {
      const resp = await fetch(url, { headers });
      if (!resp.ok) {
        res.status(resp.ok ? 200 : 502).json({
          numeroControlePNCP: numeroControle,
          arquivos: [],
          erro: `PNCP retornou HTTP ${resp.status}`,
          urlTentado: url,
        });
        return;
      }
      const data = await resp.json();
      const lista = Array.isArray(data) ? data : (data?.arquivos || data?.resultado || []);

      // Normaliza os arquivos pra estrutura previsivel
      const arquivos = lista.map((a: any) => ({
        tipo: a.tipoDocumentoNome || a.tipoDocumento || a.tipo || 'ANEXO',
        titulo: a.titulo || a.nomeArquivo || a.nome || '',
        sequencial: a.sequencialDocumento || a.sequencial || null,
        dataPublicacao: a.dataPublicacaoPncp || a.dataPublicacao || '',
        url: a.url || (a.sequencialDocumento
          ? `https://pncp.gov.br/pncp-api/v1/orgaos/${cnpj}/compras/${ano}/${seq}/arquivos/${a.sequencialDocumento}`
          : ''),
      })).filter((a: any) => a.url);

      // Detecta o PDF do edital (prioridade: EDITAL > AVISO > TERMO_REFERENCIA > primeiro)
      const acharPorTipo = (regex: RegExp) =>
        arquivos.find((a: any) => regex.test(String(a.tipo).toUpperCase()) || regex.test(String(a.titulo).toUpperCase()));
      const editalPdf = acharPorTipo(/EDITAL/)
        || acharPorTipo(/AVISO/)
        || acharPorTipo(/TERMO[_\s]+(DE\s+)?REFERENCIA/)
        || arquivos[0];

      res.set('Cache-Control', 'public, max-age=86400'); // 24h — arquivos sao imutaveis
      res.json({
        numeroControlePNCP: numeroControle,
        totalArquivos: arquivos.length,
        arquivos,
        linkEditalPdf: editalPdf?.url || '',
        linkPaginaPncp: `https://pncp.gov.br/app/editais/${cnpj}/${ano}/${seq}`,
      });
    } catch (e: any) {
      console.error('Falha ao obter arquivos PNCP:', e);
      res.status(502).json({
        numeroControlePNCP: numeroControle,
        arquivos: [],
        erro: e?.message || String(e),
      });
    }
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

/**
 * Valida um código CATMAT (material) OU CATSER (serviço) consultando
 * a API oficial do Compras.gov.br. Devolve a descrição oficial pra que
 * o usuário confirme que o código corresponde ao item esperado.
 *
 * NÃO existe endpoint público de busca por texto livre — a API só
 * aceita busca por código exato. O usuário precisa achar o código
 * manualmente no portal https://catalogo.compras.gov.br/ e colar aqui.
 *
 * Uso:
 *   GET /validarCatmat?codigo=437936&tipo=material
 *   GET /validarCatmat?codigo=3603&tipo=servico
 *
 * Resposta de sucesso:
 *   { valido: true, codigo, nome, descricao, tipo, grupo, classe, ncm, status }
 *
 * Resposta de não-encontrado:
 *   { valido: false, motivo: 'Código não existe no catálogo oficial.' }
 */
export const validarCatmat = functions
  .runWith({ timeoutSeconds: 30, memory: '256MB' })
  .https.onRequest(async (req, res) => {
    const origin = pickAllowedOrigin(req.headers.origin as string | undefined);
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Vary', 'Origin');

    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'GET') { res.status(405).json({ error: 'Apenas GET é suportado.' }); return; }

    const codigo = String(req.query.codigo || '').trim();
    if (!codigo || !/^\d+$/.test(codigo)) {
      res.status(400).json({ valido: false, motivo: 'Query param "codigo" obrigatório e numérico.' });
      return;
    }
    const tipo = String(req.query.tipo || 'material').toLowerCase();
    const isServico = tipo === 'servico' || tipo === 'serviço' || tipo === 'catser';

    // A API exige tamanhoPagina entre 10 e 500. Se omitir os params de
    // paginação, retorna 200 com 1 registro (que é o nosso caso). Por
    // segurança usamos só o filtro por código.
    const url = isServico
      ? `https://dadosabertos.compras.gov.br/modulo-servico/6_consultarItemServico?codigoServico=${encodeURIComponent(codigo)}`
      : `https://dadosabertos.compras.gov.br/modulo-material/4_consultarItemMaterial?codigoItem=${encodeURIComponent(codigo)}`;

    try {
      const resp = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'LIE-Projetos/1.0 (+https://projetos.lie.com.br)'
        }
      });

      if (!resp.ok) {
        res.status(resp.status).json({
          valido: false,
          motivo: `API governamental retornou HTTP ${resp.status}.`
        });
        return;
      }

      const data = await resp.json();
      const lista = data.resultado || data.data || [];
      if (!Array.isArray(lista) || lista.length === 0) {
        res.set('Cache-Control', 'public, max-age=86400'); // cache 1 dia (negativo)
        res.json({
          valido: false,
          motivo: `Código ${codigo} não foi encontrado no catálogo oficial ${isServico ? 'CATSER' : 'CATMAT'}.`
        });
        return;
      }

      const item = lista[0];
      res.set('Cache-Control', 'public, max-age=2592000'); // cache 30 dias
      res.json({
        valido: true,
        codigo: Number(item.codigoItem || item.codigoServico || codigo),
        tipo: isServico ? 'servico' : 'material',
        nome: item.nomePdm || item.nomeClasse || item.nomeGrupo || '',
        descricao: item.descricaoItem || item.descricaoServico || item.descricao || '',
        grupo: item.nomeGrupo || '',
        classe: item.nomeClasse || '',
        pdm: item.nomePdm || '',
        ncm: item.codigo_ncm || item.codigoNcm || '',
        status: item.statusItem || item.statusServico || '',
        sustentavel: !!item.itemSustentavel
      });
    } catch (e: any) {
      console.error('Falha ao validar CATMAT/CATSER:', e);
      res.status(502).json({
        valido: false,
        motivo: 'Falha ao consultar a API oficial. Tente novamente.',
        detail: e?.message || String(e)
      });
    }
  });

/**
 * Coleta agregada de preços de mercado para um CATMAT/CATSER.
 *
 * Consulta os 3 endpoints do dadosabertos.compras.gov.br em paralelo,
 * calcula estatísticas (mín/máx/médio/mediano) e cacheia no Firestore
 * em 'marketCache/{codigo}' por 24h. Subsequentes leituras retornam
 * direto do cache (custo zero).
 *
 * Uso:
 *   GET /coletarMercadoItem?codigoCatmat=445484
 *   GET /coletarMercadoItem?codigoCatmat=445484&forceRefresh=true
 *   GET /coletarMercadoItem?codigoCatmat=3603&tipo=servico
 *
 * Resposta:
 * {
 *   codigoCatmat, totalCotacoes, fonteCache,
 *   estatisticas: { minimo, maximo, medio, mediano },
 *   cotacoes: [...]    // até 50 cotações detalhadas
 * }
 */
export const coletarMercadoItem = functions
  .runWith({ timeoutSeconds: 60, memory: '512MB' })
  .https.onRequest(async (req, res) => {
    const origin = pickAllowedOrigin(req.headers.origin as string | undefined);
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Vary', 'Origin');

    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'GET') { res.status(405).json({ error: 'Apenas GET é suportado.' }); return; }

    const codigoCatmat = String(req.query.codigoCatmat || '').trim();
    if (!codigoCatmat || !/^\d+$/.test(codigoCatmat)) {
      res.status(400).json({ error: 'Query param "codigoCatmat" obrigatório e numérico.' });
      return;
    }
    const tipo = String(req.query.tipo || 'material').toLowerCase();
    const isServico = tipo === 'servico' || tipo === 'serviço' || tipo === 'catser';
    const forceRefresh = String(req.query.forceRefresh || '').toLowerCase() === 'true';

    const cacheRef = admin.firestore()
      .collection('marketCache')
      .doc(`${isServico ? 'svc' : 'mat'}_${codigoCatmat}`);

    // 1. Verifica cache (24h TTL)
    if (!forceRefresh) {
      try {
        const snap = await cacheRef.get();
        if (snap.exists) {
          const data = snap.data() as any;
          const atualizado = data.atualizadoEm?.toDate?.() || new Date(0);
          const idadeHoras = (Date.now() - atualizado.getTime()) / (1000 * 60 * 60);
          if (idadeHoras < 24) {
            res.set('Cache-Control', 'public, max-age=3600');
            res.json({ ...data, fonteCache: 'firestore', idadeHoras: Math.round(idadeHoras * 10) / 10 });
            return;
          }
        }
      } catch (e) {
        console.warn('Falha lendo cache, vai consultar API:', e);
      }
    }

    // 2. Consulta APIs em paralelo
    const base = 'https://dadosabertos.compras.gov.br';
    const headers = {
      Accept: 'application/json',
      'User-Agent': 'LIE-Projetos/1.0 (+https://projetos.lie.com.br)'
    };
    const tamanho = 500;

    type Fonte = { nome: string; url: string };
    const fontes: Fonte[] = isServico
      ? [{
          nome: 'compras-servico',
          url: `${base}/modulo-pesquisa-preco/3_consultarServico?codigoItemCatalogo=${codigoCatmat}&pagina=1&tamanhoPagina=${tamanho}`
        }]
      : [
          {
            nome: 'compras.gov.br',
            url: `${base}/modulo-pesquisa-preco/1_consultarMaterial?codigoItemCatalogo=${codigoCatmat}&pagina=1&tamanhoPagina=${tamanho}`
          },
          {
            nome: 'pncp-contratacao',
            url: `${base}/modulo-contratacoes/2_consultarItensContratacoes_PNCP_14133?codigoItemCatalogo=${codigoCatmat}&pagina=1&tamanhoPagina=${tamanho}`
          },
          {
            nome: 'pncp-ata',
            url: `${base}/modulo-arp/2_consultarARPItem?codigoItemCatalogo=${codigoCatmat}&pagina=1&tamanhoPagina=${tamanho}`
          }
        ];

    const buscarFonte = async (f: Fonte): Promise<{ fonte: string; registros: any[] }> => {
      try {
        const resp = await fetch(f.url, { headers });
        if (!resp.ok) return { fonte: f.nome, registros: [] };
        const data = await resp.json();
        const arr = data.resultado || data.data || [];
        return { fonte: f.nome, registros: Array.isArray(arr) ? arr : [] };
      } catch {
        return { fonte: f.nome, registros: [] };
      }
    };

    const resultados = await Promise.all(fontes.map(buscarFonte));

    // Normaliza cotações (formato enxuto pra cache)
    type Cotacao = {
      fonte: string;
      orgao: string;
      uasg: string;
      cnpjOrgao: string;
      identificadorCompra: string;
      numeroControlePNCP: string;
      dataHomologacao: string;
      dataPublicacao: string;
      dataVigenciaFinalAta: string;
      modalidade: string;
      situacao: string;
      criterioJulgamento: string;
      modoDisputa: string;
      amparoLegal: string;
      leiAplicada: string;
      objetoCompra: string;
      poder: string;
      esfera: string;
      uf: string;
      municipio: string;
      fornecedorNome: string;
      fornecedorCnpj: string;
      inscricaoEstadualFornecedor: string;
      codigoCatalogoItem: string;
      quantidade: number;
      unidadeMedida: string;
      valorUnitario: number;
      // Unidades — essencial pra comparação correta
      unidadeFornecimento: string;        // ex: "GARRAFA"
      siglaUnidadeFornecimento: string;   // ex: "GRF"
      capacidadeUnidadeFornecimento: number; // ex: 500 (significa "garrafa de 500ml")
      siglaUnidadeMedida: string;         // ex: "ML" (unidade da capacidade)
      marca: string;                      // ex: "Água Mineral s/ Gás"
      // Preço normalizado por unidade base (R$ por ml/g/un)
      precoPorUnidadeBase: number;        // ex: 0.0023 (R$ por ML)
      // ---
      descricaoItem: string;
      linkPncp: string;
    };

    const cotacoes: Cotacao[] = [];
    for (const { fonte, registros } of resultados) {
      for (const r of registros) {
        const valor = Number(r.valorUnitario || r.valorUnitarioEstimado || r.valorUnitarioHomologado || r.precoUnitario) || 0;
        if (valor <= 0) continue;

        const numCtrl = r.numeroControlePNCP || r.numeroControlePNCPCompra || r.numeroControlePNCPAta || '';
        let link = r.linkProcesso || '';
        const m = String(numCtrl).match(/^(\d{14})-[\dA-Z]+-(\d+)\/(\d{4})$/);
        if (m) {
          const tipoLink = fonte === 'pncp-ata' ? 'atas' : 'editais';
          link = `https://pncp.gov.br/app/${tipoLink}/${m[1]}/${m[3]}/${m[2]}`;
        } else if (r.uasg) {
          link = `https://pncp.gov.br/app/contratacoes?q=${r.uasg}`;
        }

        const capacidade = Number(r.capacidadeUnidadeFornecimento) || 0;
        const siglaMedida = String(r.siglaUnidadeMedida || r.unidadeMedida || '').trim().toUpperCase();
        // preço por unidade base: se garrafa de 500ml custa R$ 1,15 → R$ 0,0023/ml
        const precoPorUnidadeBase = capacidade > 0 ? valor / capacidade : 0;

        // Heuristica pra detectar lei aplicada (mesma logica do consultarPrecosMulti)
        const modalidadeStr = String(r.nomeModalidadeCompra || r.modalidade || '').toLowerCase();
        const amparoStr = String(r.amparoLegalNome || r.amparoLegal || '').toLowerCase();
        const detectarLei = (): string => {
          if (amparoStr.includes('14.133') || amparoStr.includes('14133')) return 'Lei 14.133/2021';
          if (amparoStr.includes('8.666') || amparoStr.includes('8666')) return 'Lei 8.666/1993';
          if (amparoStr.includes('10.520') || amparoStr.includes('10520')) return 'Lei 10.520/2002';
          if (amparoStr.includes('13.303') || amparoStr.includes('13303')) return 'Lei 13.303/2016';
          if (modalidadeStr.includes('pregao') && fonte === 'pncp-contratacao') return 'Lei 14.133/2021';
          if (modalidadeStr.includes('pregao')) return 'Lei 10.520/2002';
          if (modalidadeStr.includes('dispensa') || modalidadeStr.includes('inexigibilidade')) {
            return fonte === 'pncp-contratacao' ? 'Lei 14.133/2021' : 'Lei 8.666/1993';
          }
          return fonte === 'pncp-contratacao' || fonte === 'pncp-ata' ? 'Lei 14.133/2021' : '';
        };

        cotacoes.push({
          fonte,
          orgao: r.orgaoLicitante || r.nomeOrgao || r.razaoSocialOrgao || r.orgaoEntidadeNome || r.nomeOrgaoEntidade || 'ÓRGÃO PÚBLICO',
          uasg: String(r.uasg || r.codigoUasg || r.codigoUnidadeAdministrativa || ''),
          cnpjOrgao: String(r.cnpjOrgao || r.orgaoEntidadeCnpj || r.cnpj || ''),
          identificadorCompra: String(r.idCompra || r.processo || r.numeroProcesso || r.numeroCompra || r.numeroAta || r.numeroAtaRegistroPreco || ''),
          numeroControlePNCP: String(numCtrl || ''),
          dataHomologacao: String(r.dataCompra || r.dataResultado || r.dataPublicacaoPncp || r.dataAssinatura || r.dataAprovacaoAta || ''),
          dataPublicacao: String(r.dataPublicacaoPncp || r.dataPublicacao || ''),
          dataVigenciaFinalAta: String(r.dataVigenciaFinalAta || r.dataFimVigencia || ''),
          modalidade: String(r.nomeModalidadeCompra || r.modalidade || r.modalidadeCompra || r.modalidadeNome || ''),
          situacao: String(r.situacaoCompraItem || r.situacaoCompra || r.situacao || (r.temResultado ? 'Homologado' : '')),
          criterioJulgamento: String(r.criterioJulgamentoNome || r.criterioJulgamento || r.nomeCriterioJulgamento || ''),
          modoDisputa: String(r.modoDisputaNome || r.modoDisputa || r.nomeModoDisputa || ''),
          amparoLegal: String(r.amparoLegalNome || r.amparoLegal || ''),
          leiAplicada: detectarLei(),
          objetoCompra: String(r.objetoCompra || r.objeto || r.descricaoCompra || ''),
          poder: String(r.poder || r.orgaoEntidadePoder || ''),
          esfera: String(r.esfera || r.orgaoEntidadeEsfera || ''),
          uf: String(r.uf || r.orgaoEntidadeUfSigla || r.estado || r.siglaUf || ''),
          municipio: String(r.municipio || r.orgaoEntidadeMunicipioNome || r.nomeMunicipio || ''),
          fornecedorNome: String(r.nomeFornecedor || r.razaoSocialFornecedor || r.fornecedorNome || ''),
          fornecedorCnpj: String(r.niFornecedor || r.codFornecedor || r.cnpjFornecedor || r.fornecedorCnpj || ''),
          inscricaoEstadualFornecedor: String(r.inscricaoEstadualFornecedor || r.ieFornecedor || r.inscricaoEstadual || ''),
          codigoCatalogoItem: String(r.codItemCatalogo || r.codigoItemCatalogo || r.codigoItemCatalogoCompra || ''),
          quantidade: Number(r.quantidade) || 0,
          unidadeMedida: String(r.unidadeMedida || r.siglaUnidadeMedida || ''),
          valorUnitario: valor,
          unidadeFornecimento: String(r.nomeUnidadeFornecimento || '').trim().toUpperCase(),
          siglaUnidadeFornecimento: String(r.siglaUnidadeFornecimento || '').trim().toUpperCase(),
          capacidadeUnidadeFornecimento: capacidade,
          siglaUnidadeMedida: siglaMedida,
          marca: String(r.marca || '').trim(),
          precoPorUnidadeBase,
          descricaoItem: String(r.descricaoItem || r.descricao || ''),
          linkPncp: link
        });
      }
    }

    // === Estatísticas + saneamento iterativo (Método TCU) ===
    // Critério: CV ≤ 25% (consagrado por manuais UFG/UFC/UFPE + STJ).
    // Corte: μ ± 1σ amostral (n-1). Para com ≥3 remanescentes ou CV ≤ 25%.
    // Fundamento: Acórdãos TCU 1.875/2021-P, 403/2013-1C, 3.068/2010 +
    // IN SEGES/ME 65/2021 art. 6º.

    type IteracaoSaneamento = {
      iteracao: number;
      n: number;
      media: number;
      desvioPadrao: number;
      coeficienteVariacao: number;  // %
      limiteSuperior: number;
      limiteInferior: number;
      excluidosNestaIteracao: number;
    };

    const desvioPadraoAmostral = (vals: number[], media: number): number => {
      if (vals.length < 2) return 0;
      const sumSq = vals.reduce((acc, v) => acc + Math.pow(v - media, 2), 0);
      return Math.sqrt(sumSq / (vals.length - 1));
    };

    const calcularStats = (valores: number[]) => {
      const ord = [...valores].sort((a, b) => a - b);
      const k = ord.length;
      if (k === 0) return { minimo: 0, maximo: 0, medio: 0, mediano: 0, desvioPadrao: 0, coeficienteVariacao: 0 };
      const media = ord.reduce((a, b) => a + b, 0) / k;
      const dp = desvioPadraoAmostral(ord, media);
      return {
        minimo: ord[0],
        maximo: ord[k - 1],
        medio: Math.round(media * 100) / 100,
        mediano: k % 2 === 0
          ? Math.round(((ord[k / 2 - 1] + ord[k / 2]) / 2) * 100) / 100
          : ord[Math.floor(k / 2)],
        desvioPadrao: Math.round(dp * 100) / 100,
        coeficienteVariacao: media > 0 ? Math.round((dp / media) * 10000) / 100 : 0  // %
      };
    };

    // Saneamento iterativo TCU.
    // Recebe array de {valor, idx} e marca quais cotações sobreviveram.
    type PontoSaneamento = { valor: number; idxCotacao: number; excluidoIteracao?: number };

    const aplicarSaneamentoTCU = (pontos: PontoSaneamento[]): {
      pontosFinais: PontoSaneamento[];
      iteracoes: IteracaoSaneamento[];
      convergiu: boolean;
      metodoFinal: 'media-saneada' | 'mediana-fallback' | 'media-original';
    } => {
      const LIMITE_CV = 25;  // %
      const MAX_ITER = 20;
      const iteracoes: IteracaoSaneamento[] = [];
      let atuais = [...pontos];

      for (let iter = 0; iter < MAX_ITER; iter++) {
        if (atuais.length < 3) {
          // Fallback: < 3 sobreviventes — não pode prosseguir
          return { pontosFinais: pontos, iteracoes, convergiu: false, metodoFinal: 'mediana-fallback' };
        }
        const vals = atuais.map(p => p.valor);
        const media = vals.reduce((a, b) => a + b, 0) / vals.length;
        const dp = desvioPadraoAmostral(vals, media);
        const cv = media > 0 ? (dp / media) * 100 : 0;
        const LS = media + dp;
        const LI = media - dp;

        // Registra iteração
        iteracoes.push({
          iteracao: iter + 1,
          n: atuais.length,
          media: Math.round(media * 100) / 100,
          desvioPadrao: Math.round(dp * 100) / 100,
          coeficienteVariacao: Math.round(cv * 100) / 100,
          limiteSuperior: Math.round(LS * 100) / 100,
          limiteInferior: Math.round(LI * 100) / 100,
          excluidosNestaIteracao: 0
        });

        if (cv <= LIMITE_CV) {
          // Convergiu — aceita amostra atual
          return {
            pontosFinais: atuais,
            iteracoes,
            convergiu: true,
            metodoFinal: iter === 0 ? 'media-original' : 'media-saneada'
          };
        }

        // Marca outliers
        const proxAtuais: PontoSaneamento[] = [];
        let removidos = 0;
        for (const p of atuais) {
          if (p.valor < LI || p.valor > LS) {
            p.excluidoIteracao = iter + 1;
            removidos++;
          } else {
            proxAtuais.push(p);
          }
        }
        iteracoes[iter].excluidosNestaIteracao = removidos;

        // Se não removeu ninguém nesta iteração, para (evita loop)
        if (removidos === 0) {
          return { pontosFinais: atuais, iteracoes, convergiu: false, metodoFinal: 'mediana-fallback' };
        }
        atuais = proxAtuais;
      }
      return { pontosFinais: atuais, iteracoes, convergiu: false, metodoFinal: 'mediana-fallback' };
    };

    const valores = cotacoes.map(c => c.valorUnitario);
    const n = valores.length;

    // Estatística da amostra completa (sem saneamento)
    const estatisticasOriginais = calcularStats(valores);

    // Aplica saneamento TCU sobre valorUnitario (cada cotação tem seu peso)
    const pontosOrig: PontoSaneamento[] = cotacoes.map((c, i) => ({ valor: c.valorUnitario, idxCotacao: i }));
    const saneamento = aplicarSaneamentoTCU(pontosOrig);

    // Estatísticas pós-saneamento
    const valoresSaneados = saneamento.pontosFinais.map(p => p.valor);
    const estatisticasSaneadas = calcularStats(valoresSaneados);

    // Preço de referência conforme método final
    const precoReferencia = saneamento.convergiu
      ? estatisticasSaneadas.medio
      : estatisticasOriginais.mediano;

    // Marca outliers nas cotações
    const idxExcluidos = new Set(
      pontosOrig.filter(p => p.excluidoIteracao !== undefined).map(p => p.idxCotacao)
    );
    const motivosExclusao = new Map<number, string>();
    pontosOrig.forEach(p => {
      if (p.excluidoIteracao !== undefined) {
        motivosExclusao.set(
          p.idxCotacao,
          `Excluído na iteração ${p.excluidoIteracao} (fora de μ±σ)`
        );
      }
    });

    // Mantém estrutura antiga em 'estatisticas' = ORIGINAL pra retrocompatibilidade,
    // e adiciona 'saneamento' com dados completos.
    const estatisticas = {
      minimo: estatisticasOriginais.minimo,
      maximo: estatisticasOriginais.maximo,
      medio: estatisticasOriginais.medio,
      mediano: estatisticasOriginais.mediano
    };

    // === Estatísticas POR UNIDADE DE FORNECIMENTO ===
    // Permite ao usuário comparar com a unidade certa quando há mistura
    // (ex: 12 cotações em GARRAFA 500ML + 3 em COPO 200ML).
    const porUnidade: Record<string, {
      unidade: string;
      siglaMedida: string;
      capacidade: number;
      totalCotacoes: number;
      estatisticas: ReturnType<typeof calcularStats>;
      // Preço normalizado por unidade base (mediana de R$/ml ou R$/g)
      precoPorUnidadeBaseMediano: number;
    }> = {};

    for (const c of cotacoes) {
      // Chave: unidade + capacidade + sigla (ex: "GARRAFA-500-ML")
      const chave = `${c.unidadeFornecimento || 'N/A'}-${c.capacidadeUnidadeFornecimento || 0}-${c.siglaUnidadeMedida || ''}`;
      if (!porUnidade[chave]) {
        porUnidade[chave] = {
          unidade: c.unidadeFornecimento || 'NÃO INFORMADO',
          siglaMedida: c.siglaUnidadeMedida || '',
          capacidade: c.capacidadeUnidadeFornecimento || 0,
          totalCotacoes: 0,
          estatisticas: { minimo: 0, maximo: 0, medio: 0, mediano: 0, desvioPadrao: 0, coeficienteVariacao: 0 },
          precoPorUnidadeBaseMediano: 0
        };
      }
    }
    // Calcula estatísticas por unidade
    for (const chave of Object.keys(porUnidade)) {
      const cots = cotacoes.filter(c =>
        `${c.unidadeFornecimento || 'N/A'}-${c.capacidadeUnidadeFornecimento || 0}-${c.siglaUnidadeMedida || ''}` === chave
      );
      porUnidade[chave].totalCotacoes = cots.length;
      porUnidade[chave].estatisticas = calcularStats(cots.map(c => c.valorUnitario));
      const precosBase = cots.map(c => c.precoPorUnidadeBase).filter(p => p > 0);
      if (precosBase.length > 0) {
        const ord = precosBase.sort((a, b) => a - b);
        const k = ord.length;
        porUnidade[chave].precoPorUnidadeBaseMediano = k % 2 === 0
          ? (ord[k / 2 - 1] + ord[k / 2]) / 2
          : ord[Math.floor(k / 2)];
      }
    }

    // Adiciona flags de outlier em cada cotação
    const cotacoesComFlag = cotacoes.map((c, i) => ({
      ...c,
      outlier: idxExcluidos.has(i),
      motivoExclusao: motivosExclusao.get(i) || null
    }));

    // Trunca a 50 cotações pra cache leve (ordenadas por data DESC se houver)
    const cotacoesTopo = cotacoesComFlag
      .sort((a, b) => (b.dataHomologacao || '').localeCompare(a.dataHomologacao || ''))
      .slice(0, 50);

    // Unidade dominante (mais cotações) — usada no resumo da coluna
    const unidadesOrdenadas = Object.values(porUnidade).sort((a, b) => b.totalCotacoes - a.totalCotacoes);
    const unidadeDominante = unidadesOrdenadas[0] || null;

    const payload = {
      codigoCatmat: Number(codigoCatmat),
      tipo: isServico ? 'servico' : 'material',
      totalCotacoes: n,
      estatisticas,
      // Saneamento estatístico TCU
      saneamento: {
        metodo: saneamento.metodoFinal,
        convergiu: saneamento.convergiu,
        limiteCV: 25,
        cotacoesIncluidas: saneamento.pontosFinais.length,
        cotacoesExcluidas: n - saneamento.pontosFinais.length,
        precoReferencia: Math.round(precoReferencia * 100) / 100,
        estatisticasFinais: estatisticasSaneadas,
        iteracoes: saneamento.iteracoes,
        baseLegal: 'Lei 14.133/2021 art. 23 • IN SEGES/ME 65/2021 art. 6º • Manual SEGES + Acórdãos TCU 1.875/2021-P, 403/2013-1C'
      },
      porUnidade: unidadesOrdenadas,
      unidadeDominante,
      cotacoes: cotacoesTopo,
      atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
    };

    // 3. Salva no cache (não bloqueia resposta)
    cacheRef.set(payload).catch(e => console.warn('Falha gravando cache:', e));

    res.set('Cache-Control', 'public, max-age=3600');
    res.json({
      ...payload,
      atualizadoEm: new Date().toISOString(),
      fonteCache: 'api-fresh'
    });
  });
