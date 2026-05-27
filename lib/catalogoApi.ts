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
