// ============================================================================
// LIE — Cliente da Cloud Function coletarMercadoItem
// ============================================================================
//
// Devolve estatísticas (mín/máx/médio/mediano) + cotações detalhadas pra
// um CATMAT/CATSER validado. Cache de 24h no Firestore — chamadas subsequentes
// pro mesmo código são instantâneas.

import { storage } from './firebase';

export interface CotacaoMercado {
  fonte: string;
  orgao: string;
  uasg: string;
  cnpjOrgao: string;
  identificadorCompra: string;
  dataHomologacao: string;
  modalidade: string;
  valorUnitario: number;
  unidadeMedida: string;
  descricaoItem: string;
  linkPncp: string;
}

export interface EstatisticasMercado {
  minimo: number;
  maximo: number;
  medio: number;
  mediano: number;
}

export interface MercadoResposta {
  codigoCatmat: number;
  tipo: 'material' | 'servico';
  totalCotacoes: number;
  estatisticas: EstatisticasMercado;
  cotacoes: CotacaoMercado[];
  fonteCache: 'firestore' | 'api-fresh';
  atualizadoEm: string;
  idadeHoras?: number;
}

function mercadoUrl(codigoCatmat: number, tipo: 'material' | 'servico', forceRefresh = false): string {
  const projectId = storage.app.options.projectId;
  const params = new URLSearchParams({ codigoCatmat: String(codigoCatmat), tipo });
  if (forceRefresh) params.set('forceRefresh', 'true');
  return `https://us-central1-${projectId}.cloudfunctions.net/coletarMercadoItem?${params}`;
}

/**
 * Busca dados de mercado pra um CATMAT/CATSER. Cache 24h no Firestore via
 * Cloud Function. Use `forceRefresh=true` pra ignorar cache e bater na API
 * gov (útil pra forçar atualização manual no botão "Atualizar mercado").
 */
export async function coletarMercadoItem(
  codigoCatmat: number,
  tipo: 'material' | 'servico' = 'material',
  forceRefresh = false
): Promise<MercadoResposta | null> {
  try {
    const resp = await fetch(mercadoUrl(codigoCatmat, tipo, forceRefresh), {
      headers: { Accept: 'application/json' }
    });
    if (!resp.ok) {
      console.warn(`coletarMercadoItem retornou HTTP ${resp.status} pra ${codigoCatmat}`);
      return null;
    }
    return await resp.json();
  } catch (e) {
    console.warn('Falha coletarMercadoItem:', e);
    return null;
  }
}

/**
 * Coleta em lote, paralelo controlado (4 simultâneas pra não estourar
 * timeouts da Cloud Function que tem cooldown).
 */
export async function coletarMercadoLote(
  itens: { codigoCatmat: number; tipo: 'material' | 'servico' }[],
  concorrencia = 4
): Promise<Record<number, MercadoResposta | null>> {
  const result: Record<number, MercadoResposta | null> = {};
  let cursor = 0;

  const runner = async () => {
    while (cursor < itens.length) {
      const idx = cursor++;
      const { codigoCatmat, tipo } = itens[idx];
      result[codigoCatmat] = await coletarMercadoItem(codigoCatmat, tipo);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concorrencia, itens.length) }, () => runner()));
  return result;
}
