// ============================================================================
// LIE — Cliente da API REST do Catálogo Compras.gov.br (SERPRO)
// ============================================================================
//
// Esta API é a que o próprio portal https://catalogo.compras.gov.br/ usa
// internamente. CORS é aberto, então podemos chamar direto do browser.
//
// IMPORTANTE: API não tem swagger público, então estamos usando endpoints
// descobertos via inspeção do bundle Angular do portal. Se algum endpoint
// quebrar, abrir o DevTools no portal e olhar as chamadas XHR pra confirmar.

import { storage } from './firebase';

const BASE = 'https://cnbs.estaleiro.serpro.gov.br/cnbs-api';

const HEADERS = { Accept: 'application/json' };

/**
 * Busca PDMs (Padrões Descritivos de Material) por palavra-chave.
 * Cada PDM agrupa vários itens CATMAT com características diferentes
 * (ex: PDM "ÁGUA MINERAL NATURAL" tem itens para "Sem Gás Plástico",
 * "Com Gás Vidro", etc.)
 */
export interface PdmMatch {
  codigoPdm: number;
  nomePdm: string;
  codigoClasse?: number;
  nomeClasse?: string;
  codigoGrupo?: number;
  descricaoGrupo?: string;
  statusPDM?: string;
}

export async function buscarPdmsPorPalavra(palavra: string, apenasAtivos = true): Promise<PdmMatch[]> {
  if (!palavra || palavra.trim().length < 2) return [];
  const url = `${BASE}/material/v1/palavra?palavra=${encodeURIComponent(palavra.trim())}${apenasAtivos ? '' : '&apenasAtivos=nao'}`;
  try {
    const resp = await fetch(url, { headers: HEADERS });
    if (!resp.ok) return [];
    const data = await resp.json();
    return Array.isArray(data) ? data as PdmMatch[] : [];
  } catch (e) {
    console.warn('Falha ao buscar PDMs:', e);
    return [];
  }
}

/**
 * Busca serviços (CATSER) por palavra-chave.
 */
export interface ServicoMatch {
  codigoServico: number;
  descricaoServicoAcentuado?: string;
  descricaoServico?: string;
  codigoCPC?: string;
  codigoGrupo?: number;
  nomeGrupo?: string;
  suspenso?: boolean;
}

export async function buscarServicosPorPalavra(palavra: string): Promise<ServicoMatch[]> {
  if (!palavra || palavra.trim().length < 2) return [];
  const url = `${BASE}/servico/v1/palavra?palavra=${encodeURIComponent(palavra.trim())}`;
  try {
    const resp = await fetch(url, { headers: HEADERS });
    if (!resp.ok) return [];
    const data = await resp.json();
    return Array.isArray(data) ? data as ServicoMatch[] : [];
  } catch (e) {
    console.warn('Falha ao buscar serviços:', e);
    return [];
  }
}

/**
 * Busca rápida unificada (autocomplete): material + serviço, retorno enxuto.
 */
export interface CatalogoHint {
  codigo: number;
  nome: string;
  tipo: 'M' | 'S'; // M = material, S = serviço
}

export async function buscarHintCatalogo(palavra: string): Promise<CatalogoHint[]> {
  if (!palavra || palavra.trim().length < 2) return [];
  const url = `${BASE}/item/v1/hint?palavra=${encodeURIComponent(palavra.trim())}`;
  try {
    const resp = await fetch(url, { headers: HEADERS });
    if (!resp.ok) return [];
    const data = await resp.json();
    return Array.isArray(data) ? data as CatalogoHint[] : [];
  } catch (e) {
    console.warn('Falha ao buscar hint:', e);
    return [];
  }
}

/**
 * Lista os itens CATMAT específicos dentro de um PDM, com características.
 * Ex: para PDM "ÁGUA MINERAL NATURAL", retorna itens 445484 (Sem Gás, Plástico),
 * 445485 (Com Gás, Vidro), etc.
 */
export interface CaracteristicaValor {
  nomeCaracteristica?: string;
  valorCaracteristica?: string;
  caracteristica?: string;
  valor?: string;
}

export interface ItemDoPdm {
  codigoItem: number;
  buscaItemCaracteristica?: CaracteristicaValor[];
  descricaoCompleta?: string;
  itemAtivo?: boolean;
  statusItem?: boolean;
  unidadeFornecimento?: string;
  ncm?: string;
}

export async function listarItensDoPdm(codigoPdm: number, apenasAtivos = true): Promise<ItemDoPdm[]> {
  const endpoint = apenasAtivos ? 'materialCaracteristcaValorporPDM' : 'materialCaracteristicaValorPdmSemFiltro';
  const url = `${BASE}/material/v1/${endpoint}?codigo_pdm=${codigoPdm}`;
  try {
    const resp = await fetch(url, { headers: HEADERS });
    if (!resp.ok) return [];
    const data = await resp.json();
    return Array.isArray(data) ? data as ItemDoPdm[] : [];
  } catch (e) {
    console.warn('Falha ao listar itens do PDM:', e);
    return [];
  }
}

/**
 * Recupera dados básicos do PDM (descrição, classe, grupo).
 */
export interface PdmDetalhe {
  codigoPdm: number;
  nomePdm?: string;
  descricaoPdm?: string;
  codigoClasse?: number;
  nomeClasse?: string;
  codigoGrupo?: number;
  nomeGrupo?: string;
}

export async function obterPdmDetalhe(codigoPdm: number): Promise<PdmDetalhe | null> {
  const url = `${BASE}/material/v1/dadosbasicospdmporcodigo?codigoPdm=${codigoPdm}`;
  try {
    const resp = await fetch(url, { headers: HEADERS });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (Array.isArray(data)) return data[0] || null;
    return data || null;
  } catch (e) {
    console.warn('Falha ao obter detalhe do PDM:', e);
    return null;
  }
}

/**
 * Detalhes completos de um item CATMAT (por código).
 */
export interface ItemMaterialDetalhe {
  codigoItem: number;
  codigoPdm?: number;
  nomePdm?: string;
  descricaoItem?: string;
  codigoNcm?: string;
  statusItem?: boolean;
}

export async function obterItemMaterial(codigoItem: number): Promise<ItemMaterialDetalhe | null> {
  const url = `${BASE}/material/v1/recuperaDadosItemMaterialPorCodigo?codigo_item_material=${codigoItem}`;
  try {
    const resp = await fetch(url, { headers: HEADERS });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (Array.isArray(data)) return data[0] || null;
    return data || null;
  } catch (e) {
    console.warn('Falha ao obter item material:', e);
    return null;
  }
}

/**
 * Detalhes de um serviço CATSER (por código).
 */
export interface ServicoDetalhe {
  codigoServico: number;
  descricaoServico?: string;
  descricaoServicoAcentuado?: string;
  nomeGrupo?: string;
  codigoGrupo?: number;
  codigoCPC?: string;
}

export async function obterServico(codigoServico: number): Promise<ServicoDetalhe | null> {
  const url = `${BASE}/servico/v1/dadosServicoPorCodigo?codigo_servico=${codigoServico}`;
  try {
    const resp = await fetch(url, { headers: HEADERS });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (Array.isArray(data)) return data[0] || null;
    return data || null;
  } catch (e) {
    console.warn('Falha ao obter serviço:', e);
    return null;
  }
}

/**
 * Calcula similaridade entre duas strings via Dice coefficient com bigramas.
 * Retorna valor entre 0 (nada parecido) e 1 (idêntico). Bom pra nomes
 * curtos como "Água Mineral" vs "Água Mineral Natural".
 */
export function similaridade(a: string, b: string): number {
  const normA = normalizar(a);
  const normB = normalizar(b);
  if (!normA || !normB) return 0;
  if (normA === normB) return 1;
  if (normA.length < 2 || normB.length < 2) return 0;

  const bigramas = (s: string): Set<string> => {
    const out = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
    return out;
  };

  const setA = bigramas(normA);
  const setB = bigramas(normB);
  let interseccao = 0;
  setA.forEach(b => { if (setB.has(b)) interseccao++; });
  return (2 * interseccao) / (setA.size + setB.size);
}

function normalizar(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Sugere o melhor PDM/serviço pro nome de um item.
 * Tenta material primeiro, depois serviço. Retorna o melhor match com
 * o score de similaridade.
 */
export interface SugestaoCatalogo {
  tipo: 'material' | 'servico';
  codigoPdm?: number;
  nomePdm?: string;
  codigoServico?: number;
  nomeServico?: string;
  classe?: string;
  grupo?: string;
  score: number;
  totalAlternativas: number;
}

export async function sugerirMelhorMatch(nome: string): Promise<SugestaoCatalogo | null> {
  if (!nome || nome.trim().length < 2) return null;

  // Tira parênteses (frequentemente ruído tipo "(caixa 48 copos)")
  const termoLimpo = nome.replace(/\([^)]*\)/g, '').trim();

  // Tenta a primeira palavra significativa (>= 3 letras) pra busca mais ampla
  const palavras = termoLimpo.split(/\s+/).filter(p => p.length >= 3);
  const palavraBusca = palavras[0] || termoLimpo;

  // Busca em paralelo material + serviço
  const [pdms, servicos] = await Promise.all([
    buscarPdmsPorPalavra(palavraBusca),
    buscarServicosPorPalavra(palavraBusca)
  ]);

  let melhor: SugestaoCatalogo | null = null;

  for (const pdm of pdms) {
    const score = similaridade(nome, pdm.nomePdm || '');
    if (!melhor || score > melhor.score) {
      melhor = {
        tipo: 'material',
        codigoPdm: pdm.codigoPdm,
        nomePdm: pdm.nomePdm,
        classe: pdm.nomeClasse,
        grupo: pdm.descricaoGrupo,
        score,
        totalAlternativas: pdms.length + servicos.length
      };
    }
  }

  for (const s of servicos) {
    const nomeServ = s.descricaoServicoAcentuado || s.descricaoServico || '';
    const score = similaridade(nome, nomeServ);
    if (!melhor || score > melhor.score) {
      melhor = {
        tipo: 'servico',
        codigoServico: s.codigoServico,
        nomeServico: nomeServ,
        grupo: s.nomeGrupo,
        score,
        totalAlternativas: pdms.length + servicos.length
      };
    }
  }

  return melhor;
}

// ============================================================================
// Busca multi-termo — sinônimos LIE → linguagem burocrática do catálogo
// ============================================================================
//
// O catálogo do SERPRO exige match quase exato. "carrinho de pipoca" retorna
// vazio, mas "fornecimento alimentação evento" retorna o CATSER certo. Esse
// dicionário mapeia termos do dia-a-dia LIE pros termos catalogados, e a
// função buscarPdmsMultiTermo/buscarServicosMultiTermo disparam todas as
// buscas em paralelo, deduplicando os resultados.

const DICIONARIO_SINONIMOS_LIE: Record<string, string[]> = {
  // ----- Alimentação / eventos -----
  'pipoca': ['fornecimento alimentação evento', 'serviço alimentação esportivo', 'venda alimento'],
  'algodão doce': ['fornecimento alimentação evento', 'serviço alimentação esportivo'],
  'lanche': ['fornecimento alimentação preparada', 'kit lanche', 'refeição'],
  'água': ['água mineral natural', 'água potável', 'bebida não alcoólica'],
  'refeição': ['fornecimento alimentação preparada', 'serviço alimentação'],
  // ----- Transporte -----
  'ônibus': ['transporte fretamento passageiros', 'locação ônibus rodoviário', 'serviço transporte coletivo'],
  'van': ['transporte fretamento passageiros', 'locação van', 'transporte escolar'],
  'fretamento': ['transporte fretamento passageiros', 'locação veículo passageiros'],
  // ----- Audiovisual / cobertura -----
  'cobertura': ['serviço fotografia evento', 'filmagem audiovisual', 'cobertura jornalística'],
  'filmagem': ['produção audiovisual evento', 'cobertura audiovisual', 'captação imagens'],
  'fotografia': ['serviço fotográfico evento', 'cobertura fotográfica'],
  'jornalística': ['assessoria imprensa', 'serviço jornalismo', 'cobertura comunicação'],
  'audiovisual': ['produção audiovisual', 'serviço captação imagens'],
  'transmissão': ['serviço streaming evento', 'transmissão ao vivo'],
  'streaming': ['transmissão ao vivo', 'captação cinematográfica'],
  // ----- Comunicação visual / impressos -----
  'backdrop': ['lona vinílica impressa', 'painel comunicação visual', 'comunicação visual evento'],
  'banner': ['lona impressa', 'comunicação visual personalizada'],
  'windbanner': ['bandeira promocional haste', 'wind banner', 'comunicação visual bandeira'],
  'placa': ['placa comunicação visual', 'placa homenagem gravada'],
  'medalha': ['medalha esportiva premiação', 'medalha personalizada'],
  'troféu': ['troféu personalizado premiação', 'troféu esportivo'],
  'certificado': ['confecção certificado personalizado', 'impressão diploma'],
  'súmula': ['impressão formulário', 'confecção bloco impresso'],
  'camiseta': ['camiseta personalizada poliéster', 'uniforme camiseta'],
  // ----- Estruturas evento -----
  'box truss': ['locação estrutura box truss alumínio', 'treliça alumínio evento'],
  'palco': ['locação palco praticável', 'estrutura modular evento'],
  'tenda': ['locação cobertura desmontável', 'locação tenda', 'barraca', 'locação estrutura modular evento'],
  'barraca': ['locação cobertura desmontável', 'cobertura passarela toldo barraca'],
  'toldo': ['locação cobertura desmontável', 'cobertura passarela toldo barraca'],
  'tendas': ['locação cobertura desmontável', 'locação tenda', 'barraca'],
  'painel led': ['locação painel led', 'telão LED alta definição'],
  'som': ['locação sistema som evento', 'sonorização evento'],
  'polionda': ['painel polipropileno ondulado', 'placa comunicação visual'],
  // ----- Saúde -----
  'ambulância': ['locação ambulância remoção', 'serviço transporte ambulância'],
  'socorrista': ['serviço primeiros socorros evento', 'atendimento pré-hospitalar'],
  'saúde': ['serviço médico evento', 'atendimento saúde evento'],
  // ----- Recurso humano -----
  'árbitro': ['serviço arbitragem esportiva', 'profissional árbitro'],
  'arbitragem': ['serviço arbitragem esportiva educacional'],
  'anotador': ['serviço anotador esportivo', 'profissional registro partidas'],
  'coordenador': ['serviço coordenação executiva', 'gestão projeto'],
  'professor': ['profissional educação física', 'consultoria acadêmica'],
  'monitor': ['serviço monitoria esportiva', 'profissional pedagógico'],
  'segurança': ['serviço segurança privada', 'vigilância evento'],
  'limpeza': ['serviço limpeza conservação evento', 'higienização espaço'],
  'locução': ['serviço locução evento', 'mestre cerimônias narração'],
  'mascote': ['serviço animação evento', 'caracterização mascote'],
  'figurino': ['confecção fantasia mascote', 'produção figurino caracterizado'],
  // ----- TI / web -----
  'website': ['desenvolvimento manutenção website', 'hospedagem portal web'],
  'sistema': ['desenvolvimento sistema web', 'plataforma digital'],
  'inscrições': ['serviço plataforma inscrição online', 'sistema cadastro online'],
};

// Stopwords genéricas que não ajudam a busca no catálogo.
const STOPWORDS_BUSCA = new Set([
  'para', 'pelo', 'pela', 'com', 'sem', 'dos', 'das', 'que', 'por',
  'uma', 'uns', 'umas', 'tipo', 'modelo', 'cada',
]);

/**
 * Extrai as palavras-chave significativas de um termo, descartando o ruído
 * de dimensão/medida que polui a busca no catálogo SERPRO.
 * Ex.: "TENDAS 3m x 3m" → ["tendas"]  (descarta "3m", "x", "3m")
 *      "PAPEL TOALHA 200 folhas" → ["papel", "toalha", "folhas"]
 * Regra: ≥3 letras, sem dígitos, fora da lista de stopwords.
 */
export function extrairPalavrasChave(termo: string): string[] {
  const limpo = normalizar(termo);
  if (!limpo) return [];
  const out: string[] = [];
  for (const p of limpo.split(' ')) {
    if (p.length < 3) continue;          // "x", "3m", "de" etc.
    if (/\d/.test(p)) continue;          // tokens com dígito = medida/dimensão
    if (STOPWORDS_BUSCA.has(p)) continue;
    if (!out.includes(p)) out.push(p);
  }
  return out;
}

/**
 * Pontua o quão relevante um nome de PDM/serviço é pro termo buscado, comparando
 * contra TODAS as variantes (termo saneado + sinônimos do dicionário). Pontuar
 * contra os sinônimos é essencial: um resultado trazido por "locação tenda" tem
 * nome "Locação cobertura desmontável" e não contém a palavra "tenda" — sem isso
 * o filtro o descartaria por engano.
 *
 * Pra cada variante conta quantas das suas palavras-chave aparecem no nome
 * (inteira ou por prefixo, cobrindo singular↔plural), pondera pela cobertura e
 * soma um bônus de similaridade. Fica com o melhor score entre as variantes.
 * Retorna 0 quando NENHUMA variante casa nada — assim filtramos lixo
 * (ex.: "cirurgia de tendão" pra "tenda").
 */
function pontuarRelevancia(nome: string, variantes: string[]): number {
  const n = normalizar(nome);
  if (!n) return 0;
  const palavras = n.split(' ').filter(Boolean);

  let melhorScore = 0;
  for (const variante of variantes) {
    const kws = extrairPalavrasChave(variante);
    if (kws.length === 0) continue;

    let acertos = 0;
    let pontos = 0;
    for (const kw of kws) {
      let m = 0;
      for (const w of palavras) {
        if (w === kw) {
          m = Math.max(m, 3);
        } else if (kw.length >= 4 && w.length >= 4 && (w.startsWith(kw) || kw.startsWith(w))) {
          // prefixo só entre palavras substanciais (tenda↔tendas), nunca com "e"/"de"
          m = Math.max(m, 2);
        }
      }
      if (m > 0) acertos++;
      pontos += m;
    }
    if (acertos === 0) continue; // essa variante não casou nada

    const cobertura = acertos / kws.length;        // fração das palavras da variante achadas
    const score = cobertura * 5 + pontos + similaridade(variante, nome) * 3;
    melhorScore = Math.max(melhorScore, score);
  }
  return melhorScore;
}

/**
 * Gera variantes de busca a partir de um termo do usuário.
 * Retorna no máximo 5 termos pra controlar o número de chamadas paralelas.
 * Estratégia:
 *   1. Frase-chave saneada (sem ruído de dimensão) — melhor sinal pro catálogo
 *   2. Sinônimos do dicionário LIE quando alguma chave bate
 *   3. Palavras-chave individuais quando há mais de uma
 */
export function gerarSinonimosBusca(termo: string): string[] {
  const limpo = normalizar(termo);
  if (!limpo) return [];

  const keywords = extrairPalavrasChave(termo);
  const frase = keywords.join(' ').trim();

  // 1. Frase saneada como variante principal; cai pro termo cru se sobrou nada.
  const variantes: string[] = [];
  variantes.push(frase || termo.trim());

  // 2. Sinônimos do dicionário (compara contra o termo e contra cada keyword,
  //    normalizando a chave pra casar mesmo com acento — ex.: "água", "ônibus").
  for (const [chave, sins] of Object.entries(DICIONARIO_SINONIMOS_LIE)) {
    const chaveNorm = normalizar(chave);
    const bate = limpo.includes(chaveNorm)
      || keywords.some(k => chaveNorm.includes(k) || k.includes(chaveNorm));
    if (bate) {
      for (const s of sins) {
        if (!variantes.includes(s)) variantes.push(s);
      }
    }
  }

  // 3. Palavras-chave individuais (se há mais de uma)
  if (keywords.length > 1) {
    for (const p of keywords) {
      if (!variantes.includes(p)) variantes.push(p);
    }
  }

  return variantes.slice(0, 5);
}

export interface PdmMatchComOrigem extends PdmMatch {
  /** Qual termo (original ou sinônimo) trouxe esse resultado */
  termoOrigem: string;
  /** 1.0 = termo original, 0.7 = sinônimo */
  scoreRelevancia: number;
}

export interface ServicoMatchComOrigem extends ServicoMatch {
  termoOrigem: string;
  scoreRelevancia: number;
}

/**
 * Busca PDMs com expansão automática de sinônimos LIE. Dispara N buscas em
 * paralelo, deduplicar por codigoPdm (mantém a primeira ocorrência = maior score).
 */
export async function buscarPdmsMultiTermo(termoOriginal: string): Promise<PdmMatchComOrigem[]> {
  const variantes = gerarSinonimosBusca(termoOriginal);
  if (variantes.length === 0) return [];

  const respostas = await Promise.all(
    variantes.map(async (termo, idx) => {
      const r = await buscarPdmsPorPalavra(termo);
      const score = idx === 0 ? 1.0 : 0.7;
      return r.map(pdm => ({ ...pdm, termoOrigem: termo, scoreRelevancia: score } as PdmMatchComOrigem));
    })
  );

  // Dedupe por codigoPdm — mantém o de maior score
  const mapa = new Map<number, PdmMatchComOrigem>();
  for (const lista of respostas) {
    for (const item of lista) {
      const existente = mapa.get(item.codigoPdm);
      if (!existente || item.scoreRelevancia > existente.scoreRelevancia) {
        mapa.set(item.codigoPdm, item);
      }
    }
  }

  // Ranqueia por relevância real (contra termo saneado + sinônimos) e descarta
  // o que não casa nenhuma palavra-chave. Lista vazia → UI sugere outra busca/IA.
  const comRelev = Array.from(mapa.values())
    .map(pdm => ({ pdm, relev: pontuarRelevancia(pdm.nomePdm || '', variantes) }))
    .filter(x => x.relev > 0);
  return comRelev
    .sort((a, b) => (b.relev - a.relev) || (b.pdm.scoreRelevancia - a.pdm.scoreRelevancia))
    .slice(0, 60)
    .map(x => x.pdm);
}

export async function buscarServicosMultiTermo(termoOriginal: string): Promise<ServicoMatchComOrigem[]> {
  const variantes = gerarSinonimosBusca(termoOriginal);
  if (variantes.length === 0) return [];

  const respostas = await Promise.all(
    variantes.map(async (termo, idx) => {
      const r = await buscarServicosPorPalavra(termo);
      const score = idx === 0 ? 1.0 : 0.7;
      return r.map(s => ({ ...s, termoOrigem: termo, scoreRelevancia: score } as ServicoMatchComOrigem));
    })
  );

  const mapa = new Map<number, ServicoMatchComOrigem>();
  for (const lista of respostas) {
    for (const item of lista) {
      const existente = mapa.get(item.codigoServico);
      if (!existente || item.scoreRelevancia > existente.scoreRelevancia) {
        mapa.set(item.codigoServico, item);
      }
    }
  }

  // Ranqueia por relevância real (contra termo saneado + sinônimos) e descarta
  // o que não casa nenhuma palavra-chave. Lista vazia → UI sugere outra busca/IA.
  const comRelev = Array.from(mapa.values())
    .map(s => ({ s, relev: pontuarRelevancia(s.descricaoServicoAcentuado || s.descricaoServico || '', variantes) }))
    .filter(x => x.relev > 0);
  return comRelev
    .sort((a, b) => (b.relev - a.relev) || (b.s.scoreRelevancia - a.s.scoreRelevancia))
    .slice(0, 60)
    .map(x => x.s);
}

/**
 * Formata as características de um item numa string legível.
 * Ex: "Tipo: Sem Gás • Material Embalagem: Plástico"
 */
export function formatarCaracteristicas(item: ItemDoPdm): string {
  if (!item.buscaItemCaracteristica || item.buscaItemCaracteristica.length === 0) {
    return item.descricaoCompleta || '';
  }
  return item.buscaItemCaracteristica
    .map(c => {
      const nome = c.nomeCaracteristica || c.caracteristica || '';
      const valor = c.valorCaracteristica || c.valor || '';
      return nome && valor ? `${nome}: ${valor}` : (valor || nome);
    })
    .filter(Boolean)
    .join(' • ');
}
