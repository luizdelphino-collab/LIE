import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import * as puppeteer from 'puppeteer';

admin.initializeApp();

// Integração Banco de Preços (proxy seguro — segredo BANCO_PRECOS_TOKEN).
export { bancoPrecosCotacoes, bancoPrecosCotacaoItens, bancoPrecosItemPrecos } from './bancoDePrecos';

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
  'http://localhost:3001',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3001',
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
        // CORRECAO: unidadeMedida = unidade da QUANTIDADE (UN/CX/FRD).
        // Antes caia em r.siglaUnidadeMedida que e a unidade da CAPACIDADE
        // da embalagem (ML/L/KG) — conceito diferente, causava confusao
        // tipo "1000 ML" quando era "1000 UN de 200ML cada".
        unidadeMedida: r.siglaUnidadeFornecimento || r.unidadeMedida || 'UN',
        // Detalhes da embalagem (separados)
        siglaUnidadeFornecimento: r.siglaUnidadeFornecimento || '',
        nomeUnidadeFornecimento: r.nomeUnidadeFornecimento || '',
        capacidadeUnidadeFornecimento: Number(r.capacidadeUnidadeFornecimento) || 0,
        siglaUnidadeMedida: r.siglaUnidadeMedida || '',
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
 * Tradutor IA: recebe um termo em linguagem natural (ex: "carrinho de pipoca
 * para evento esportivo") e usa o Gemini Flash pra retornar 3-5 candidatos
 * de CATMAT/CATSER apropriados. O frontend usa esses candidatos pra
 * consultar a API de preços (consultarPrecosMulti) e mostrar ao usuário.
 *
 * Custo: ~R$ 0,01 por busca (Gemini 2.0 Flash tem free tier de 1500/dia).
 *
 * Por que isso é necessário:
 * - As APIs federais (PNCP, Compras.gov.br) NÃO aceitam busca textual livre
 * - O Banco de Preços (paid) faz ETL próprio com full-text search; replicar
 *   é overkill (~50h + infra). Em vez disso, traduzimos texto → códigos
 *   oficiais via IA, e usamos as APIs federais que aceitam código.
 *
 * GET /traduzirTermoCatmat?termo=carrinho+de+pipoca
 *
 * Resposta:
 *  { termo, candidatos: [{ codigo, tipo, nome, descricao, justificativa, confianca }] }
 */
export const traduzirTermoCatmat = functions
  .runWith({
    timeoutSeconds: 60,  // 60s pra acomodar 3 tentativas de retry + validacoes
    memory: '256MB',
    secrets: ['GEMINI_API_KEY'],
  })
  .https.onRequest(async (req, res) => {
    const origin = pickAllowedOrigin(req.headers.origin as string | undefined);
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Vary', 'Origin');

    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'GET') { res.status(405).json({ error: 'Apenas GET é suportado.' }); return; }

    const termo = String(req.query.termo || '').trim();
    if (!termo || termo.length < 3) {
      res.status(400).json({ error: 'Query param "termo" obrigatório (>= 3 caracteres).' });
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error('GEMINI_API_KEY não disponível no ambiente');
      res.status(500).json({ error: 'Servidor sem chave Gemini configurada. Contate o admin.' });
      return;
    }

    try {
      // Lazy import pra não carregar o SDK no cold start de outras funcoes
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 8192,  // bem alto pra evitar truncamento
          responseMimeType: 'application/json',
        },
      });

      const prompt = `Você é um especialista no Catálogo CATMAT/CATSER do governo federal brasileiro (Compras.gov.br).
Sua tarefa: traduzir o termo livre que o usuário digitou em 3 a 5 candidatos REAIS de CATMAT (material) ou CATSER (serviço).

CONTEXTO: o usuário cadastra itens pra projetos da Lei de Incentivo ao Esporte (LIE/FEDEESP) — eventos esportivos escolares, olimpíadas estudantis, capacitação esportiva, etc. Foque no contexto LIE/esporte/eventos quando relevante.

REGRAS CRÍTICAS:
1. Você DEVE retornar APENAS códigos CATMAT/CATSER REAIS, que existam no catálogo Compras.gov.br
2. NÃO INVENTE códigos numéricos — se tiver dúvida, NÃO retorne candidato
3. NÃO confunda código de grupo (PDM) com código de item — itens CATMAT geralmente têm 6 dígitos
4. Pra serviços, use códigos CATSER (geralmente 5 dígitos)
5. Ordene candidatos por confiança (mais provável primeiro)
6. Cada candidato deve incluir uma justificativa clara
7. SEMPRE escreva tipo SEM acento: "servico" (não "serviço"). Use sempre lowercase.
8. Mantenha descricao e justificativa CURTAS (max 100 caracteres cada) pra evitar truncamento

TERMO DO USUÁRIO: "${termo}"

Responda em JSON puro com esta estrutura exata (sem markdown, sem comentários):
{
  "candidatos": [
    {
      "codigo": 445484,
      "tipo": "material",
      "nome": "ÁGUA MINERAL NATURAL",
      "descricao": "Água mineral natural sem gás, 500ml",
      "justificativa": "Match direto: água para hidratação",
      "confianca": 0.95
    }
  ]
}

Se não tiver candidatos confiáveis, retorne {"candidatos": []} e nada mais.`;

      // Retry com backoff exponencial em caso de 503 (overload) ou 429 (quota).
      // 429 precisa de espera longa: free tier Gemini eh 15 RPM = 1 call/4s.
      // Sinaliza 429 ao chamador via header X-RateLimit pra cliente pausar.
      const generateWithRetry = async (): Promise<string> => {
        const delaysOverload = [1000, 3000, 7000];
        const delaysQuota = [8000, 20000, 40000];  // free tier 15 RPM, espera maior
        let ultimoErro: any = null;
        for (let tentativa = 0; tentativa < 3; tentativa++) {
          try {
            const result = await model.generateContent(prompt);
            return result.response.text();
          } catch (err: any) {
            ultimoErro = err;
            const msg = String(err?.message || '');
            const isQuota = msg.includes('429') || msg.includes('quota') || msg.includes('Too Many Requests') || msg.includes('RESOURCE_EXHAUSTED');
            const isOverload = msg.includes('503') || msg.includes('overload') || msg.includes('high demand') || msg.includes('UNAVAILABLE');
            if (!isOverload && !isQuota) throw err;
            if (tentativa === 2) {
              if (isQuota) {
                (err as any).__rateLimit = true;
              }
              throw err;
            }
            const delays = isQuota ? delaysQuota : delaysOverload;
            console.warn(`Gemini ${isQuota ? 'QUOTA' : 'overloaded'} (tentativa ${tentativa + 1}). Esperando ${delays[tentativa]}ms…`);
            await new Promise(r => setTimeout(r, delays[tentativa]));
          }
        }
        throw ultimoErro;
      };
      let text: string;
      try {
        text = await generateWithRetry();
      } catch (err: any) {
        if ((err as any).__rateLimit) {
          res.set('Retry-After', '60');
          res.status(429).json({
            error: 'Gemini quota esgotada — free tier limita a 15 chamadas/minuto. Aguarde 60s e tente novamente.',
            tipo: 'quota_exceeded'
          });
          return;
        }
        throw err;
      }

      // Parse defensivo do JSON
      let parsed: any;
      try {
        parsed = JSON.parse(text);
      } catch {
        // Tenta extrair JSON de markdown ou texto com lixo
        const m = text.match(/\{[\s\S]*\}/);
        if (m) {
          try { parsed = JSON.parse(m[0]); } catch { parsed = null; }
        }
      }

      if (!parsed || !Array.isArray(parsed.candidatos)) {
        res.status(502).json({
          error: 'Resposta do Gemini não retornou JSON estruturado',
          rawSnippet: text.substring(0, 500),
        });
        return;
      }

      // Normaliza tipo (IA as vezes retorna "serviço" com acento ou variantes)
      const normalizarTipo = (t: any): 'material' | 'servico' | null => {
        const s = String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        if (s === 'material' || s === 'catmat') return 'material';
        if (s === 'servico' || s === 'catser') return 'servico';
        return null;
      };

      // Validacao basica: descarta candidatos sem codigo numerico ou tipo invalido
      const candidatosBrutos = parsed.candidatos
        .map((c: any) => {
          const tipo = normalizarTipo(c?.tipo);
          if (!c || !(Number(c.codigo) > 0) || !tipo) return null;
          return {
            codigo: Number(c.codigo),
            tipo,
            nome: String(c.nome || ''),
            descricao: String(c.descricao || ''),
            justificativa: String(c.justificativa || ''),
            confianca: Number(c.confianca) || 0.5,
          };
        })
        .filter((c: any) => c !== null)
        .slice(0, 5);

      // VALIDACAO ANTI-FRAUDE em 2 camadas:
      // CAMADA 1: codigo existe no catalogo oficial do SERPRO?
      // CAMADA 2: nome/descricao oficial bate semanticamente com o que a IA
      //          gerou? Se a IA disse "maquina de pipoca" mas o codigo oficial
      //          e "Peca Equipamento Hospitalar", e claramente alucinacao.
      //          Heuristica: Dice coefficient (bigramas) >= 0.20 entre nome IA
      //          e nome oficial — bem permissivo mas pega casos absurdos.
      const headersGov = {
        'Accept': 'application/json',
        'User-Agent': 'LIE-Projetos/1.0 (+https://projetos.lie.com.br)'
      };

      const normalizar = (s: string): string => (s || '')
        .toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
      const bigramas = (s: string): Set<string> => {
        const limpo = normalizar(s).replace(/\s/g, '');
        const set = new Set<string>();
        for (let i = 0; i < limpo.length - 1; i++) set.add(limpo.substring(i, i + 2));
        return set;
      };
      const diceScore = (a: string, b: string): number => {
        const ba = bigramas(a); const bb = bigramas(b);
        if (ba.size === 0 || bb.size === 0) return 0;
        let inter = 0;
        ba.forEach(g => { if (bb.has(g)) inter++; });
        return (2 * inter) / (ba.size + bb.size);
      };

      const validacoes = await Promise.all(candidatosBrutos.map(async (c: any) => {
        try {
          const url = c.tipo === 'servico'
            ? `https://cnbs.estaleiro.serpro.gov.br/cnbs-api/servico/v1/dadosServicoPorCodigo?codigo_servico=${c.codigo}`
            : `https://cnbs.estaleiro.serpro.gov.br/cnbs-api/material/v1/recuperaDadosItemMaterialPorCodigo?codigo_item_material=${c.codigo}`;
          const resp = await fetch(url, { headers: headersGov });
          if (!resp.ok) {
            return { ...c, validado: false, motivoDescarte: `HTTP ${resp.status} na validação` };
          }
          // Trata response vazio (codigo nao encontrado retorna body vazio em alguns casos)
          const txt = await resp.text();
          if (!txt || txt.trim().length === 0) {
            return { ...c, validado: false, motivoDescarte: 'Código não encontrado no catálogo' };
          }
          let data: any;
          try { data = JSON.parse(txt); } catch {
            return { ...c, validado: false, motivoDescarte: 'Resposta inválida do catálogo' };
          }
          const arr = Array.isArray(data) ? data : [data];
          const primeiro = arr[0];
          if (!primeiro || (!primeiro.codigoItem && !primeiro.codigoServico)) {
            return { ...c, validado: false, motivoDescarte: 'Código não encontrado no catálogo oficial' };
          }
          const nomeOficial = String(primeiro.nomePdm || primeiro.descricaoServicoAcentuado || primeiro.descricaoServico || '');
          const descOficial = String(primeiro.descricaoCompleta || primeiro.descricaoItem || primeiro.descricaoServico || '');

          // CAMADA 2: validacao semantica via Dice score
          const nomeIA = c.nome || '';
          const descIA = c.descricao || '';
          const textoIA = `${nomeIA} ${descIA}`;
          const textoOficial = `${nomeOficial} ${descOficial}`;

          // 2.a — Similaridade IA (o que a IA achou que o codigo era) vs Oficial
          const scoreIA = diceScore(textoIA, textoOficial);
          const THRESHOLD_IA = 0.35;
          if (scoreIA < THRESHOLD_IA) {
            return {
              ...c,
              validado: false,
              motivoDescarte: `IA disse "${nomeIA.substring(0, 40)}" mas oficial é "${nomeOficial.substring(0, 40)}" (similarity ${(scoreIA * 100).toFixed(0)}%)`,
            };
          }

          // 2.b — Similaridade TERMO DO USUARIO vs Nome Oficial.
          // Isso evita o caso onde a IA gerou uma descricao falsa coerente
          // (ex: "Pipoca salgada") pra um codigo que NA verdade e
          // "Reagente Clinico". O termo do user "carrinho pipoca festa" nao bate
          // com "Reagente Clinico" — descarta.
          const scoreTermo = diceScore(termo, nomeOficial);
          const THRESHOLD_TERMO = 0.20;
          if (scoreTermo < THRESHOLD_TERMO) {
            return {
              ...c,
              validado: false,
              motivoDescarte: `Termo do usuário "${termo.substring(0, 40)}" não casa com nome oficial "${nomeOficial.substring(0, 40)}" (similarity ${(scoreTermo * 100).toFixed(0)}%)`,
            };
          }

          // Passou nas 3 camadas — sobrescreve nome/desc com os oficiais
          return {
            ...c,
            nome: nomeOficial || c.nome,
            descricao: descOficial || c.descricao,
            similaridadeIA: Math.round(scoreIA * 100),
            similaridadeTermo: Math.round(scoreTermo * 100),
            validado: true,
          };
        } catch (err: any) {
          return { ...c, validado: false, motivoDescarte: `Erro na validação: ${err?.message || 'desconhecido'}` };
        }
      }));

      const candidatosValidados = validacoes.filter((c: any) => c.validado);
      const candidatosDescartados = validacoes
        .filter((c: any) => !c.validado)
        .map((c: any) => ({ codigo: c.codigo, motivo: c.motivoDescarte }));

      res.set('Cache-Control', 'public, max-age=3600');
      res.json({
        termo,
        modelo: 'gemini-2.5-flash',
        totalCandidatos: candidatosValidados.length,
        descartados: candidatosDescartados.length,
        candidatos: candidatosValidados,
        ...(candidatosDescartados.length > 0 ? { motivoDescartes: candidatosDescartados } : {}),
      });
    } catch (e: any) {
      console.error('Falha ao chamar Gemini:', e);
      res.status(502).json({
        error: 'Falha ao chamar Gemini. Tente novamente.',
        detalhe: e?.message || String(e),
      });
    }
  });

/**
 * Padronizacao de nomenclatura de item via Gemini — reescreve nome, descricao
 * e unidade do item LIE pra alinhar com a forma usada no catalogo CATMAT/CATSER
 * e nas cotacoes reais da API governamental. Protege contra "unidade difere"
 * e melhora a precisao das pesquisas de preco.
 *
 * POST /padronizarItemNomenclatura
 * Body: {
 *   itemNome, itemDescricao, itemUnidade,
 *   codigoCatmat, tipoCatmat, nomeCatmatOficial, descricaoCatmatOficial,
 *   amostraCotacoes: [{ descricaoItem, siglaUnidadeFornecimento, nomeUnidadeFornecimento, capacidadeUnidadeFornecimento, siglaUnidadeMedida }]
 * }
 *
 * Resposta: {
 *   nomeAlinhado, descricaoAlinhada, unidadeAlinhada,
 *   siglaUnidadeFornecimento, nomeUnidadeFornecimento, capacidadeUnidadeFornecimento,
 *   siglaUnidadeMedida, embalagemDescricao, fatorConversao, unidadeBase,
 *   justificativa, modelo
 * }
 */
export const padronizarItemNomenclatura = functions
  .runWith({
    timeoutSeconds: 60,
    memory: '256MB',
    secrets: ['GEMINI_API_KEY'],
  })
  .https.onRequest(async (req, res) => {
    const origin = pickAllowedOrigin(req.headers.origin as string | undefined);
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Vary', 'Origin');

    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Apenas POST eh suportado.' }); return; }

    const body = req.body || {};
    const itemNome = String(body.itemNome || '').trim();
    const itemDescricao = String(body.itemDescricao || '').trim();
    const itemUnidade = String(body.itemUnidade || '').trim();
    const codigoCatmat = Number(body.codigoCatmat);
    const tipoCatmat = String(body.tipoCatmat || 'material').trim();
    const nomeCatmatOficial = String(body.nomeCatmatOficial || '').trim();
    const descricaoCatmatOficial = String(body.descricaoCatmatOficial || '').trim();
    const amostraCotacoes = Array.isArray(body.amostraCotacoes) ? body.amostraCotacoes.slice(0, 8) : [];

    if (!itemNome || itemNome.length < 2) {
      res.status(400).json({ error: 'itemNome obrigatorio (>= 2 chars).' });
      return;
    }
    if (!(codigoCatmat > 0)) {
      res.status(400).json({ error: 'codigoCatmat obrigatorio.' });
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error('GEMINI_API_KEY nao disponivel');
      res.status(500).json({ error: 'Servidor sem chave Gemini configurada.' });
      return;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 4096,
          responseMimeType: 'application/json',
        },
      });

      // Monta amostra de cotacoes em texto compacto
      const amostraTxt = amostraCotacoes
        .map((c: any, i: number) => {
          const partes: string[] = [];
          if (c.descricaoItem) partes.push(`desc: "${String(c.descricaoItem).substring(0, 120)}"`);
          if (c.siglaUnidadeFornecimento) partes.push(`unidFornec: ${c.siglaUnidadeFornecimento}`);
          if (c.nomeUnidadeFornecimento) partes.push(`unidFornecNome: ${c.nomeUnidadeFornecimento}`);
          if (c.capacidadeUnidadeFornecimento) partes.push(`cap: ${c.capacidadeUnidadeFornecimento}${c.siglaUnidadeMedida || ''}`);
          return `${i + 1}) ${partes.join(' | ')}`;
        })
        .join('\n');

      const prompt = `Voce eh um especialista no catalogo CATMAT/CATSER do governo federal brasileiro (Compras.gov.br) e em contratacoes da Lei de Incentivo ao Esporte (LIE/FEDEESP) — eventos esportivos escolares, olimpiadas estudantis, capacitacao, FEDEESP, INTERCEUS.

TAREFA: Pegar um item cadastrado pelo usuario LIE e PADRONIZAR sua nomenclatura pra alinhar com a forma usada nas contratacoes publicas reais — facilitando comparacao de preco e auditoria.

ITEM DO USUARIO:
- Nome: "${itemNome}"
- Descricao: "${itemDescricao}"
- Unidade cadastrada: "${itemUnidade}"

VINCULO OFICIAL CATMAT/CATSER:
- Codigo: ${codigoCatmat} (${tipoCatmat})
- Nome oficial: "${nomeCatmatOficial}"
- Descricao oficial: "${descricaoCatmatOficial}"

AMOSTRA DE COTACOES REAIS (como o mercado descreve esse item):
${amostraTxt || '(sem amostras disponiveis — use seu conhecimento do catalogo e do contexto LIE)'}

REGRAS DE PADRONIZACAO:
1. ANALISE A DESCRICAO ATIVAMENTE — eh ela que define o objeto real, nao soh o nome curto. Ex: nome "COBERTURA" sozinho eh ambiguo (pode ser cobertura de bolo ou cobertura jornalistica) — a descricao desambigua. SEMPRE use a descricao como fonte de verdade.
2. SEJA FLEXIVEL com sinonimos e variacoes:
   - "CERTIFICADOS DE PARTICIPACAO" = "CONFECCAO DE CERTIFICADOS PERSONALIZADOS"
   - "COORDENADOR ACADEMICO" = "SERVICO DE COORDENACAO PEDAGOGICA"
   - "COBERTURA JORNALISTICA" = "SERVICO DE ASSESSORIA DE IMPRENSA / COBERTURA DE EVENTO"
   - "COBERTURA FOTO E FILMAGEM" = "SERVICO DE PRODUCAO AUDIOVISUAL / COBERTURA FOTOGRAFICA E FILMICA DE EVENTO"
   - "MEDALHA" = "MEDALHA PERSONALIZADA / MEDALHA ESPORTIVA PREMIACAO"
   - "MONTAGEM E DESMONTAGEM DE EVENTO" = "LOCACAO E MONTAGEM DE ESTRUTURAS PARA EVENTO"
   - "KIT LANCHE" = "FORNECIMENTO DE LANCHE PREPARADO / KIT ALIMENTACAO"
3. Use linguagem formal/burocratica do catalogo (caixa alta no nome, descricao tecnica em frase completa).
4. UNIDADE: prefira a unidade dominante nas amostras. Pra materiais use sigla padrao (UN, KG, CX, COPO, GRF). Pra servicos use o tipo (SERVICO, DIARIA, EVENTO, JOGO, DIA).
5. EMBALAGEM: se amostras CONVERGEM em capacidade (200ml, 1.5L), use ela. Se nao, use a do item original. Servicos sem embalagem deixe vazio.
6. fatorConversao = numero da capacidade (200 pro copo 200ml). unidadeBase = ML/G/M. Servicos: ambos null.
7. embalagemDescricao = texto humano (ex: "Copo 200ml", "Caixa com 48 unidades", "Diaria de servico").
8. justificativa = 1-2 frases explicando o raciocinio.

EXEMPLOS BONS:
Input: nome="MEDALHAS", desc="medalha de premiacao para evento esportivo", unidade="unidade", sem amostras
Output: nomeAlinhado="MEDALHA PERSONALIZADA PREMIACAO", descricaoAlinhada="Medalha esportiva personalizada para premiacao em evento esportivo, com gravacao da modalidade e classificacao.", unidadeAlinhada="unidade", siglaUnidadeFornecimento="UN", embalagemDescricao="Unidade individual", fatorConversao=null, unidadeBase=null

Input: nome="COBERTURA JORNALISTICA", desc="servico de cobertura de evento esportivo com producao de releases", unidade="evento", sem amostras
Output: nomeAlinhado="SERVICO DE ASSESSORIA DE IMPRENSA E COBERTURA JORNALISTICA", descricaoAlinhada="Servico de cobertura jornalistica de evento esportivo, incluindo producao de releases, materias e divulgacao em midias.", unidadeAlinhada="evento", siglaUnidadeFornecimento="EVENTO", embalagemDescricao="Servico por evento", fatorConversao=null, unidadeBase=null

Input: nome="COORDENADOR ACADEMICO", desc="profissional para coordenacao pedagogica de evento educacional", unidade="diaria"
Output: nomeAlinhado="SERVICO DE COORDENACAO PEDAGOGICA ACADEMICA", descricaoAlinhada="Servico profissional de coordenacao pedagogica para evento educacional/esportivo, com planejamento e supervisao das atividades.", unidadeAlinhada="diaria", siglaUnidadeFornecimento="DIARIA", embalagemDescricao="Diaria de servico", fatorConversao=null, unidadeBase=null

RESPONDA APENAS COM JSON puro (sem markdown):
{
  "nomeAlinhado": "...",
  "descricaoAlinhada": "...",
  "unidadeAlinhada": "...",
  "siglaUnidadeFornecimento": "...",
  "nomeUnidadeFornecimento": "...",
  "capacidadeUnidadeFornecimento": 0,
  "siglaUnidadeMedida": "...",
  "embalagemDescricao": "...",
  "fatorConversao": null,
  "unidadeBase": null,
  "justificativa": "..."
}`;

      // Retry com backoff — 503 (overload) curto + 429 (quota) longo
      const generateWithRetry = async (): Promise<string> => {
        const delaysOverload = [1000, 3000, 7000];
        const delaysQuota = [8000, 20000, 40000];
        let ultimoErro: any = null;
        for (let tentativa = 0; tentativa < 3; tentativa++) {
          try {
            const result = await model.generateContent(prompt);
            return result.response.text();
          } catch (err: any) {
            ultimoErro = err;
            const msg = String(err?.message || '');
            const isQuota = msg.includes('429') || msg.includes('quota') || msg.includes('Too Many Requests') || msg.includes('RESOURCE_EXHAUSTED');
            const isOverload = msg.includes('503') || msg.includes('overload') || msg.includes('UNAVAILABLE');
            if (!isOverload && !isQuota) throw err;
            if (tentativa === 2) {
              if (isQuota) (err as any).__rateLimit = true;
              throw err;
            }
            const delays = isQuota ? delaysQuota : delaysOverload;
            console.warn(`Gemini ${isQuota ? 'QUOTA' : 'overloaded'} padronizar (tentativa ${tentativa + 1}). Esperando ${delays[tentativa]}ms`);
            await new Promise(r => setTimeout(r, delays[tentativa]));
          }
        }
        throw ultimoErro;
      };

      let text: string;
      try {
        text = await generateWithRetry();
      } catch (err: any) {
        if ((err as any).__rateLimit) {
          res.set('Retry-After', '60');
          res.status(429).json({
            error: 'Gemini quota esgotada — free tier limita a 15 chamadas/minuto. Aguarde 60s e tente novamente.',
            tipo: 'quota_exceeded'
          });
          return;
        }
        throw err;
      }

      let parsed: any;
      try { parsed = JSON.parse(text); }
      catch {
        const m = text.match(/\{[\s\S]*\}/);
        if (m) { try { parsed = JSON.parse(m[0]); } catch { parsed = null; } }
      }

      if (!parsed || typeof parsed !== 'object') {
        res.status(502).json({ error: 'Resposta Gemini sem JSON estruturado', rawSnippet: text.substring(0, 500) });
        return;
      }

      // Validacao basica de saneidade
      const nomeAlinhado = String(parsed.nomeAlinhado || '').trim();
      if (!nomeAlinhado || nomeAlinhado.length < 2) {
        res.status(502).json({ error: 'IA retornou nomeAlinhado invalido', rawSnippet: text.substring(0, 500) });
        return;
      }

      // Anti-deriva por SIMILARIDADE Dice (bigramas) — tolera variacoes morfologicas
      // ("CERTIFICADOS" vs "CERTIFICADO", "COORDENADOR" vs "COORDENACAO") que o
      // match exato de tokens rejeitaria injustamente. Compara nome+descricao
      // do usuario contra nome+descricao alinhados pela IA, tambem aceita match
      // com a referencia oficial CATMAT/CATSER.
      const descricaoAlinhadaSan = String(parsed.descricaoAlinhada || '').trim();
      const normSan = (s: string): string => (s || '')
        .toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
      const bigramSet = (s: string): Set<string> => {
        const limpo = normSan(s).replace(/\s/g, '');
        const out = new Set<string>();
        for (let i = 0; i < limpo.length - 1; i++) out.add(limpo.substring(i, i + 2));
        return out;
      };
      const diceSan = (a: string, b: string): number => {
        const ba = bigramSet(a); const bb = bigramSet(b);
        if (ba.size === 0 || bb.size === 0) return 0;
        let inter = 0; ba.forEach(g => { if (bb.has(g)) inter++; });
        return (2 * inter) / (ba.size + bb.size);
      };
      const textoUsuario = `${itemNome} ${itemDescricao}`;
      const textoOficial = `${nomeCatmatOficial} ${descricaoCatmatOficial}`;
      const textoAlinhado = `${nomeAlinhado} ${descricaoAlinhadaSan}`;
      const scoreVsUsuario = diceSan(textoUsuario, textoAlinhado);
      const scoreVsOficial = diceSan(textoOficial, textoAlinhado);
      const THRESHOLD = 0.18;  // bem permissivo — pega soh casos absurdos
      if (Math.max(scoreVsUsuario, scoreVsOficial) < THRESHOLD) {
        res.status(502).json({
          error: `IA derivou demais (similaridade muito baixa): usuario=${(scoreVsUsuario * 100).toFixed(0)}%, oficial=${(scoreVsOficial * 100).toFixed(0)}%`,
          alinhado: { nome: nomeAlinhado, descricao: descricaoAlinhadaSan },
          original: { nome: itemNome, descricao: itemDescricao },
          oficial: { nome: nomeCatmatOficial, descricao: descricaoCatmatOficial },
          rawSnippet: text.substring(0, 500),
        });
        return;
      }

      res.set('Cache-Control', 'public, max-age=3600');
      res.json({
        modelo: 'gemini-2.5-flash',
        nomeAlinhado,
        descricaoAlinhada: String(parsed.descricaoAlinhada || '').trim(),
        unidadeAlinhada: String(parsed.unidadeAlinhada || '').trim(),
        siglaUnidadeFornecimento: String(parsed.siglaUnidadeFornecimento || '').trim().toUpperCase(),
        nomeUnidadeFornecimento: String(parsed.nomeUnidadeFornecimento || '').trim(),
        capacidadeUnidadeFornecimento: Number(parsed.capacidadeUnidadeFornecimento) || 0,
        siglaUnidadeMedida: String(parsed.siglaUnidadeMedida || '').trim().toUpperCase(),
        embalagemDescricao: String(parsed.embalagemDescricao || '').trim(),
        fatorConversao: parsed.fatorConversao === null || parsed.fatorConversao === undefined
          ? null
          : Number(parsed.fatorConversao) || null,
        unidadeBase: String(parsed.unidadeBase || '').trim().toUpperCase() || null,
        justificativa: String(parsed.justificativa || '').trim(),
      });
    } catch (err: any) {
      console.error('Erro em padronizarItemNomenclatura:', err);
      res.status(500).json({ error: err?.message || 'Erro interno' });
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
          // unidadeMedida = unidade da QUANTIDADE (UN/CX/GRF/COPO).
          // siglaUnidadeMedida e unidade da CAPACIDADE (ML/L/KG) — nao pode entrar aqui.
          unidadeMedida: String(r.siglaUnidadeFornecimento || r.unidadeMedida || 'UN'),
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

/**
 * Sincroniza dados de PDMs (Padrao Descritivo de Material) e CATSERs
 * da API SERPRO CNBS no Firestore, criando indice local pra o wizard
 * de cadastro consultar rapidamente sem latencia de API externa.
 *
 * POST /sincronizarCatalogoCNBS
 * Body: { codigosCatmat: [445484, ...], codigosCatser: [3603, ...] }
 *
 * Salva em duas colecoes:
 * - catalogo_pdms/{codigoPdm}: dados do PDM + caracteristicas + valores possiveis
 * - catalogo_servicos/{codigoServico}: dados do CATSER
 *
 * Hidrata os items vinculados ao PDM tambem (`itensVinculados` array).
 */
export const sincronizarCatalogoCNBS = functions
  .runWith({ timeoutSeconds: 540, memory: '512MB' })
  .https.onRequest(async (req, res) => {
    const origin = pickAllowedOrigin(req.headers.origin as string | undefined);
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Vary', 'Origin');

    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Apenas POST eh suportado.' }); return; }

    const body = req.body || {};
    const codigosCatmat: number[] = Array.isArray(body.codigosCatmat)
      ? body.codigosCatmat.map((n: any) => Number(n)).filter((n: number) => n > 0)
      : [];
    const codigosCatser: number[] = Array.isArray(body.codigosCatser)
      ? body.codigosCatser.map((n: any) => Number(n)).filter((n: number) => n > 0)
      : [];

    if (codigosCatmat.length === 0 && codigosCatser.length === 0) {
      res.status(400).json({ error: 'Informe codigosCatmat ou codigosCatser (ao menos 1).' });
      return;
    }

    const headersGov = {
      'Accept': 'application/json',
      'User-Agent': 'LIE-Projetos/1.0 (+https://projetos.lie.com.br)'
    };
    const db = admin.firestore();

    type PdmCache = {
      codigoPdm: number;
      nomePdm: string;
      codigoClasse: number;
      caracteristicas: Array<{
        codigo: string;
        nome: string;
        obrigatoria: boolean;
        numero: number;
        valores: Array<{
          codigo: string;
          nome: string;
          siglaUnidadeMedida: string | null;
          ativo: boolean;
        }>;
      }>;
      itensVinculados: Array<{
        codigoItem: number;
        atributos: Array<{ codigo: string; codigoValor: string; nome: string; nomeValor: string }>;
      }>;
      sincronizadoEm: admin.firestore.FieldValue;
      fonteSync: 'manual' | 'auto-cadastro';
    };

    const pdmsProcessados = new Map<number, PdmCache>();
    const servicosProcessados: any[] = [];
    const erros: Array<{ codigo: number; tipo: string; motivo: string }> = [];

    // ETAPA 1: Pra cada CATMAT, busca o PDM correspondente
    for (const codigoCatmat of codigosCatmat) {
      try {
        const urlItem = `https://cnbs.estaleiro.serpro.gov.br/cnbs-api/material/v1/recuperaDadosItemMaterialPorCodigo?codigo_item_material=${codigoCatmat}`;
        const resp = await fetch(urlItem, { headers: headersGov });
        if (!resp.ok) {
          erros.push({ codigo: codigoCatmat, tipo: 'material', motivo: `HTTP ${resp.status}` });
          continue;
        }
        const txt = await resp.text();
        if (!txt || txt.trim().length === 0) {
          erros.push({ codigo: codigoCatmat, tipo: 'material', motivo: 'Resposta vazia' });
          continue;
        }
        let data: any;
        try { data = JSON.parse(txt); }
        catch { erros.push({ codigo: codigoCatmat, tipo: 'material', motivo: 'JSON invalido' }); continue; }

        const codigoPdm = Number(data.codigoPdm);
        if (!(codigoPdm > 0)) {
          erros.push({ codigo: codigoCatmat, tipo: 'material', motivo: 'Sem codigoPdm' });
          continue;
        }

        // Se este PDM ja foi processado, soh adiciona o item na lista vinculada
        if (!pdmsProcessados.has(codigoPdm)) {
          // Busca caracteristicas completas do PDM (todos os valores possiveis)
          const urlCarac = `https://cnbs.estaleiro.serpro.gov.br/cnbs-api/material/v1/caracteristicaPorCodigoPdm?codigo_pdm=${codigoPdm}&todos=true`;
          const respCarac = await fetch(urlCarac, { headers: headersGov });
          let caracteristicas: PdmCache['caracteristicas'] = [];
          if (respCarac.ok) {
            const caracTxt = await respCarac.text();
            try {
              const caracData = JSON.parse(caracTxt);
              if (Array.isArray(caracData)) {
                caracteristicas = caracData.map((c: any) => ({
                  codigo: String(c.codigoCaracteristica || ''),
                  nome: String(c.nomeCaracteristica || ''),
                  obrigatoria: !!c.caracteristicaObrigatoria,
                  numero: Number(c.numeroCaracteristica) || 0,
                  valores: (Array.isArray(c.valorCaracteristica) ? c.valorCaracteristica : [])
                    .filter((v: any) => v && v.statusValorCaracteristica !== false)
                    .map((v: any) => ({
                      codigo: String(v.codigoValorCaracteristica || ''),
                      nome: String(v.nomeValorCaracteristica || ''),
                      siglaUnidadeMedida: v.siglaUnidadeMedida || null,
                      ativo: v.statusValorCaracteristica !== false,
                    })),
                }));
              }
            } catch { /* ignora caracteristicas malformadas */ }
          }

          pdmsProcessados.set(codigoPdm, {
            codigoPdm,
            nomePdm: String(data.nomePdm || ''),
            codigoClasse: Number(data.codigoClasse) || 0,
            caracteristicas,
            itensVinculados: [],
            sincronizadoEm: admin.firestore.FieldValue.serverTimestamp(),
            fonteSync: 'manual',
          });
        }

        // Adiciona este item especifico aos vinculados do PDM
        const pdm = pdmsProcessados.get(codigoPdm)!;
        const atributosItem = (Array.isArray(data.buscaItemCaracteristica) ? data.buscaItemCaracteristica : [])
          .map((c: any) => ({
            codigo: String(c.codigoCaracteristica || ''),
            codigoValor: String(c.codigoValorCaracteristica || ''),
            nome: String(c.nomeCaracteristica || ''),
            nomeValor: String(c.nomeValorCaracteristica || ''),
          }));
        pdm.itensVinculados.push({ codigoItem: codigoCatmat, atributos: atributosItem });
      } catch (e: any) {
        erros.push({ codigo: codigoCatmat, tipo: 'material', motivo: e?.message || 'erro' });
      }
    }

    // ETAPA 2: Pra cada CATSER, busca dados basicos do servico
    for (const codigoCatser of codigosCatser) {
      try {
        const urlServ = `https://cnbs.estaleiro.serpro.gov.br/cnbs-api/servico/v1/dadosServicoPorCodigo?codigo_servico=${codigoCatser}`;
        const resp = await fetch(urlServ, { headers: headersGov });
        if (!resp.ok) {
          erros.push({ codigo: codigoCatser, tipo: 'servico', motivo: `HTTP ${resp.status}` });
          continue;
        }
        const txt = await resp.text();
        if (!txt || txt.trim().length === 0) {
          erros.push({ codigo: codigoCatser, tipo: 'servico', motivo: 'Resposta vazia' });
          continue;
        }
        const data = JSON.parse(txt);
        servicosProcessados.push({
          codigoServico: Number(data.codigoServico),
          codigoGrupo: Number(data.codigoGrupo) || 0,
          nomeGrupo: String(data.nomeGrupo || ''),
          descricao: String(data.descricaoServicoAcentuado || data.descricaoServico || ''),
          codigoNbs: data.codigoNbs || null,
          descricaoNbs: data.descricaoNbs || null,
          ativo: data.statusServico !== false,
          sincronizadoEm: admin.firestore.FieldValue.serverTimestamp(),
          fonteSync: 'manual',
        });
      } catch (e: any) {
        erros.push({ codigo: codigoCatser, tipo: 'servico', motivo: e?.message || 'erro' });
      }
    }

    // ETAPA 3: Persiste tudo em Firestore em batch
    const batch = db.batch();
    let writes = 0;
    for (const pdm of pdmsProcessados.values()) {
      batch.set(db.collection('catalogo_pdms').doc(String(pdm.codigoPdm)), pdm, { merge: true });
      writes++;
    }
    for (const serv of servicosProcessados) {
      batch.set(db.collection('catalogo_servicos').doc(String(serv.codigoServico)), serv, { merge: true });
      writes++;
    }
    if (writes > 0) {
      try { await batch.commit(); }
      catch (e: any) {
        res.status(500).json({ error: 'Erro ao gravar batch: ' + (e?.message || 'desconhecido') });
        return;
      }
    }

    res.json({
      pdmsAtualizados: pdmsProcessados.size,
      servicosAtualizados: servicosProcessados.length,
      itensVinculadosTotal: Array.from(pdmsProcessados.values()).reduce((s, p) => s + p.itensVinculados.length, 0),
      erros,
      timestamp: new Date().toISOString(),
    });
  });

/**
 * gerarPlanoTrabalho — Assistente de IA do Plano de Trabalho (Fase A: campos narrativos).
 * Recebe um brief curto + contexto do projeto/entidade e devolve os textos formais
 * do plano de trabalho LIE: resumo, objetivo geral, objetivos específicos,
 * justificativa, caracterização socioeconômica e metodologia.
 *
 * POST JSON: { titulo, brief?, modalidades?, publicoAlvo?, local?, periodoMeses?,
 *              historicoEntidade?, entidadeNome?, instrumentoOrigem? }
 * Resposta: { resumo, objetivoGeral, objetivosEspecificos[], justificativa,
 *             caracterizacaoSocioeconomica, metodologia }
 */
export const gerarPlanoTrabalho = functions
  .runWith({ timeoutSeconds: 120, memory: '512MB', secrets: ['GEMINI_API_KEY'] })
  .https.onRequest(async (req, res) => {
    const origin = pickAllowedOrigin(req.headers.origin as string | undefined);
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Vary', 'Origin');

    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Apenas POST é suportado.' }); return; }

    const body = (req.body || {}) as Record<string, any>;
    const titulo = String(body.titulo || '').trim();
    if (!titulo) { res.status(400).json({ error: 'Campo "titulo" é obrigatório.' }); return; }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error('GEMINI_API_KEY não disponível no ambiente');
      res.status(500).json({ error: 'Servidor sem chave Gemini configurada.' });
      return;
    }

    const modalidades = Array.isArray(body.modalidades) ? body.modalidades.join(', ') : String(body.modalidades || '');
    const ctx = [
      `TÍTULO DO PROJETO: ${titulo}`,
      body.entidadeNome ? `ENTIDADE PROPONENTE: ${body.entidadeNome}` : '',
      body.historicoEntidade ? `HISTÓRICO DA ENTIDADE: ${String(body.historicoEntidade).slice(0, 2500)}` : '',
      body.instrumentoOrigem ? `INSTRUMENTO: ${body.instrumentoOrigem}` : '',
      modalidades ? `MODALIDADES ESPORTIVAS: ${modalidades}` : '',
      body.publicoAlvo ? `PÚBLICO-ALVO: ${body.publicoAlvo}` : '',
      body.local ? `LOCAL DE EXECUÇÃO: ${body.local}` : '',
      body.periodoMeses ? `DURAÇÃO: ${body.periodoMeses} meses` : '',
      (body.mesInicio && body.mesTermino) ? `PERÍODO: de ${body.mesInicio} a ${body.mesTermino} (formato AAAA-MM)` : '',
      body.brief ? `DESCRIÇÃO LIVRE DO PROPONENTE: ${String(body.brief).slice(0, 1500)}` : '',
    ].filter(Boolean).join('\n');

    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        generationConfig: { temperature: 0.6, maxOutputTokens: 8192, responseMimeType: 'application/json' },
      });

      const prompt = `Você é um especialista em elaboração de projetos esportivos da Lei de Incentivo ao Esporte (LIE) no Brasil, que redige Planos de Trabalho formais para aprovação em órgãos públicos (Ministério do Esporte, Secretarias estaduais/municipais).

Sua tarefa: a partir do contexto abaixo, redigir os textos do Plano de Trabalho em português formal, técnico, impessoal e institucional, adequados à análise de um parecerista público. Seja específico e concreto — evite frases genéricas vazias. USE FORTEMENTE o histórico da entidade fornecido para dar credibilidade (trajetória, experiência, resultados).

CONTEXTO DO PROJETO:
${ctx}

DIRETRIZES DE REDAÇÃO (padrão de planos de trabalho esportivos aprovados):
1. TOM: impessoal, institucional, formal e técnico. Terceira pessoa.
2. MARCO LEGAL: fundamente sempre que cabível na Constituição Federal art. 217 (prioridade ao desporto educacional), na Lei Pelé (Lei 9.615/1998) e na Lei Geral do Esporte (Lei 14.597/2023); para o esporte escolar, cite também LDB, PNE e BNCC. Priorize a categoria "Desporto Educacional".
3. JUSTIFICATIVA em camadas, nesta lógica: (a) marco legal; (b) relevância do esporte como política pública de transformação social e educacional; (c) credibilidade da ENTIDADE com base no histórico fornecido; (d) alinhamento aos Objetivos de Desenvolvimento Sustentável (ODS) da ONU pertinentes — tipicamente ODS 3 (Saúde e Bem-Estar), 4 (Educação de Qualidade), 5 (Igualdade de Gênero), 10 (Redução das Desigualdades) e 16 (Paz, Justiça e Instituições). Cite os ODS pelos nomes.
4. OBJETIVOS ESPECÍFICOS: cada um inicia com verbo no infinitivo e, quando possível, traz uma meta quantitativa (ex.: "Atender X estudantes", "Capacitar Y professores").
5. CARACTERIZAÇÃO SOCIOECONÔMICA: descreva o perfil socioeconômico do público e do território (escolas públicas, vulnerabilidade, acesso ao esporte). Use enquadramento geral plausível; NÃO invente números oficiais precisos de IDH/IBGE — se não houver dados, escreva de forma qualitativa consistente.
6. METODOLOGIA: descreva a execução em etapas operacionais concretas (mobilização/divulgação, inscrição, realização das atividades/competições, premiação, monitoramento e prestação de contas) e a abordagem pedagógica/esportiva.
7. PLANO DE DIVULGAÇÃO: objetivos da divulgação + estratégias por canal (assessoria de imprensa, redes sociais, comunicação direta com escolas e com o órgão parceiro).

Produza:
- resumo: 1 a 2 parágrafos densos apresentando o projeto (o quê, para quem, onde, quantos, por quê).
- objetivoGeral: 1 parágrafo articulando ação + público + finalidade social + base legal.
- objetivosEspecificos: 4 a 6 itens (verbo no infinitivo + quantitativo quando possível).
- justificativa: 3 a 4 parágrafos seguindo as camadas (a)-(d) acima.
- caracterizacaoSocioeconomica: 1 a 2 parágrafos.
- metodologia: 2 a 3 parágrafos com as etapas operacionais.
- planoDivulgacao: 1 a 2 parágrafos com objetivos e estratégias de comunicação.
- metasQualitativas: 3 metas QUALITATIVAS. Cada uma é um objeto com: "meta" (título curto, ex.: "Satisfação dos participantes"), "indicador" (o que se mede), "formula" (como se calcula — ex.: "Escala Likert de 5 pontos"), "verificacao" (meio de verificação — ex.: "Questionário aplicado a todos os participantes").
- metasQuantitativas: 3 metas QUANTITATIVAS. Mesmos 4 campos, mas mensuráveis por números (ex.: meta "Participações", indicador "Nº de inscritos/presentes", formula "Contagem via sistema de inscrição", verificacao "Listas de presença e relatórios").
- cronograma: 5 a 8 ações do projeto, cada uma com "acao" (título), "descricao" (detalhe), "mesInicio" e "mesTermino" no formato AAAA-MM DENTRO do período informado. Inclua mobilização/divulgação no início e prestação de contas ao final.

Responda APENAS em JSON puro (sem markdown), nesta estrutura exata:
{
  "resumo": "...",
  "objetivoGeral": "...",
  "objetivosEspecificos": ["...", "...", "..."],
  "justificativa": "...",
  "caracterizacaoSocioeconomica": "...",
  "metodologia": "...",
  "planoDivulgacao": "...",
  "metasQualitativas": [{"meta":"...","indicador":"...","formula":"...","verificacao":"..."}],
  "metasQuantitativas": [{"meta":"...","indicador":"...","formula":"...","verificacao":"..."}],
  "cronograma": [{"acao":"...","descricao":"...","mesInicio":"AAAA-MM","mesTermino":"AAAA-MM"}]
}`;

      const generateWithRetry = async (): Promise<string> => {
        const delays = [1000, 4000, 9000];
        let ultimoErro: any = null;
        for (let tentativa = 0; tentativa < 3; tentativa++) {
          try {
            const result = await model.generateContent(prompt);
            return result.response.text();
          } catch (err: any) {
            ultimoErro = err;
            const msg = String(err?.message || '');
            const transiente = /429|503|quota|overload|UNAVAILABLE|RESOURCE_EXHAUSTED/i.test(msg);
            if (transiente && tentativa < 2) {
              await new Promise(r => setTimeout(r, delays[tentativa]));
              continue;
            }
            throw err;
          }
        }
        throw ultimoErro;
      };

      const texto = await generateWithRetry();
      let data: any;
      try {
        data = JSON.parse(texto);
      } catch {
        const m = texto.match(/\{[\s\S]*\}/);
        data = m ? JSON.parse(m[0]) : null;
      }
      if (!data || typeof data !== 'object') {
        res.status(502).json({ error: 'Resposta da IA não pôde ser interpretada.' });
        return;
      }
      const mapMetas = (arr: any) => Array.isArray(arr)
        ? arr.slice(0, 6).map((m: any) => ({
            meta: String(m?.meta || ''),
            indicador: String(m?.indicador || ''),
            formula: String(m?.formula || ''),
            verificacao: String(m?.verificacao || ''),
          })).filter((m: any) => m.meta)
        : [];
      const mapCrono = (arr: any) => Array.isArray(arr)
        ? arr.slice(0, 30).map((a: any) => ({
            acao: String(a?.acao || ''),
            descricao: String(a?.descricao || ''),
            mesInicio: String(a?.mesInicio || ''),
            mesTermino: String(a?.mesTermino || ''),
          })).filter((a: any) => a.acao)
        : [];

      res.status(200).json({
        resumo: String(data.resumo || ''),
        objetivoGeral: String(data.objetivoGeral || ''),
        objetivosEspecificos: Array.isArray(data.objetivosEspecificos) ? data.objetivosEspecificos.map(String) : [],
        justificativa: String(data.justificativa || ''),
        caracterizacaoSocioeconomica: String(data.caracterizacaoSocioeconomica || ''),
        metodologia: String(data.metodologia || ''),
        planoDivulgacao: String(data.planoDivulgacao || ''),
        metasQualitativas: mapMetas(data.metasQualitativas),
        metasQuantitativas: mapMetas(data.metasQuantitativas),
        cronograma: mapCrono(data.cronograma),
        modelo: 'gemini-2.5-flash',
      });
    } catch (e: any) {
      console.error('gerarPlanoTrabalho erro:', e?.message || e);
      res.status(500).json({ error: 'Falha ao gerar o plano: ' + (e?.message || String(e)) });
    }
  });

/**
 * gerarMemorialCalculo — escreve o Memorial de Cálculo de UM item do orçamento.
 * Justifica a quantidade conectando-a aos parâmetros do projeto (público, eventos,
 * etapas, meses) e referencia o preço (valor unitário + mediana de mercado).
 *
 * POST JSON: { itemNome, unidade, valorUnitario, quantidadeTotal, distribuicao?,
 *              tituloProjeto?, publicoAlvo?, modalidades?, periodoMeses?, medianaReferencia? }
 * Resposta: { memorial }
 */
export const gerarMemorialCalculo = functions
  .runWith({ timeoutSeconds: 60, memory: '256MB', secrets: ['GEMINI_API_KEY'] })
  .https.onRequest(async (req, res) => {
    const origin = pickAllowedOrigin(req.headers.origin as string | undefined);
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Vary', 'Origin');
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Apenas POST.' }); return; }

    const b = (req.body || {}) as Record<string, any>;
    const itemNome = String(b.itemNome || '').trim();
    if (!itemNome) { res.status(400).json({ error: 'itemNome é obrigatório.' }); return; }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) { res.status(500).json({ error: 'Servidor sem chave Gemini.' }); return; }

    const mods = Array.isArray(b.modalidades) ? b.modalidades.join(', ') : String(b.modalidades || '');
    const ctx = [
      `ITEM: ${itemNome}`,
      b.unidade ? `UNIDADE: ${b.unidade}` : '',
      (b.quantidadeTotal != null) ? `QUANTIDADE TOTAL: ${b.quantidadeTotal}` : '',
      b.distribuicao ? `DISTRIBUIÇÃO POR MÊS: ${String(b.distribuicao).slice(0, 400)}` : '',
      (b.valorUnitario != null) ? `VALOR UNITÁRIO: R$ ${b.valorUnitario}` : '',
      (b.medianaReferencia != null && b.medianaReferencia > 0) ? `MEDIANA DA PESQUISA DE PREÇO: R$ ${b.medianaReferencia}` : '',
      b.tituloProjeto ? `PROJETO: ${b.tituloProjeto}` : '',
      b.publicoAlvo ? `PÚBLICO-ALVO: ${b.publicoAlvo}` : '',
      mods ? `MODALIDADES: ${mods}` : '',
      b.periodoMeses ? `DURAÇÃO: ${b.periodoMeses} meses` : '',
    ].filter(Boolean).join('\n');

    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        generationConfig: { temperature: 0.45, maxOutputTokens: 4096, responseMimeType: 'application/json' },
      });

      const prompt = `Você é um especialista em planos de trabalho esportivos (Lei de Incentivo ao Esporte / FEDEESP) que redige MEMORIAIS DE CÁLCULO para aprovação por pareceristas públicos.

Escreva o memorial de cálculo do item abaixo: um texto formal e técnico (2 a 4 frases) que JUSTIFICA a quantidade do item, conectando-a aos parâmetros do projeto (nº de participantes/público, modalidades, eventos/etapas, meses de execução e a distribuição mensal). Quando houver, explicite a conta (ex.: "X por participante × Y participantes × Z eventos = total"). Referencie o valor unitário e, se houver, a mediana da pesquisa de preço como respaldo. NÃO invente números além dos fornecidos; use apenas os dados abaixo.

DADOS:
${ctx}

Responda APENAS em JSON puro: {"memorial": "..."}`;

      const result = await model.generateContent(prompt);
      const txt = result.response.text();
      let data: any;
      try { data = JSON.parse(txt); } catch { const m = txt.match(/\{[\s\S]*\}/); data = m ? JSON.parse(m[0]) : null; }
      res.status(200).json({ memorial: String(data?.memorial || ''), modelo: 'gemini-2.5-flash' });
    } catch (e: any) {
      console.error('gerarMemorialCalculo erro:', e?.message || e);
      res.status(500).json({ error: 'Falha ao gerar memorial: ' + (e?.message || String(e)) });
    }
  });
