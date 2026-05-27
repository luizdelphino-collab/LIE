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
