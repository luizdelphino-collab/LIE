// LIE — Cliente do cache local de PDMs/CATSERs (Fase 2 redesign 2026-05-29)
//
// O cache vive em duas colecoes do Firestore:
// - catalogo_pdms/{codigoPdm}: dados do PDM + caracteristicas + valores possiveis
// - catalogo_servicos/{codigoServico}: dados do CATSER
//
// A sincronizacao eh feita via Cloud Function `sincronizarCatalogoCNBS`,
// que busca dados frescos da API SERPRO CNBS.

import { doc, getDoc, collection, query, where, getDocs, orderBy, limit, type Timestamp } from 'firebase/firestore';
import { storage, db } from './firebase';

export interface PdmCacheCaracteristica {
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
}

export interface PdmCacheItemVinculado {
  codigoItem: number;
  atributos: Array<{ codigo: string; codigoValor: string; nome: string; nomeValor: string }>;
}

export interface PdmCache {
  codigoPdm: number;
  nomePdm: string;
  codigoClasse: number;
  caracteristicas: PdmCacheCaracteristica[];
  itensVinculados: PdmCacheItemVinculado[];
  sincronizadoEm: Timestamp;
  fonteSync: 'manual' | 'auto-cadastro';
}

export interface ServicoCache {
  codigoServico: number;
  codigoGrupo: number;
  nomeGrupo: string;
  descricao: string;
  codigoNbs: string | null;
  descricaoNbs: string | null;
  ativo: boolean;
  sincronizadoEm: Timestamp;
  fonteSync: 'manual' | 'auto-cadastro';
}

export interface SincronizarRespostaCatalogo {
  pdmsAtualizados: number;
  servicosAtualizados: number;
  itensVinculadosTotal: number;
  erros: Array<{ codigo: number; tipo: string; motivo: string }>;
  timestamp: string;
}

/**
 * Chama a Cloud Function `sincronizarCatalogoCNBS` pra hidratar/atualizar
 * o cache local de PDMs e CATSERs a partir dos codigos passados.
 *
 * Aceita ate ~100 codigos por chamada (Cloud Functions tem timeout 540s).
 * Pra batch maior, dividir em paginas.
 */
export async function sincronizarCatalogoCNBS(input: {
  codigosCatmat?: number[];
  codigosCatser?: number[];
}): Promise<SincronizarRespostaCatalogo | null> {
  const codigosCatmat = (input.codigosCatmat || []).filter(n => n > 0);
  const codigosCatser = (input.codigosCatser || []).filter(n => n > 0);
  if (codigosCatmat.length === 0 && codigosCatser.length === 0) return null;

  const projectId = storage.app.options.projectId;
  const url = `https://us-central1-${projectId}.cloudfunctions.net/sincronizarCatalogoCNBS`;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ codigosCatmat, codigosCatser }),
    });
    if (!resp.ok) {
      const txt = await resp.text();
      console.warn(`sincronizarCatalogoCNBS HTTP ${resp.status}: ${txt.substring(0, 200)}`);
      return null;
    }
    return await resp.json();
  } catch (e) {
    console.warn('Falha em sincronizarCatalogoCNBS:', e);
    return null;
  }
}

/**
 * Busca um PDM do cache local (Firestore).
 * Retorna null se nao tiver sido cacheado ainda.
 */
export async function getPdmFromCache(codigoPdm: number): Promise<PdmCache | null> {
  if (!(codigoPdm > 0)) return null;
  try {
    const snap = await getDoc(doc(db, 'catalogo_pdms', String(codigoPdm)));
    if (!snap.exists()) return null;
    return snap.data() as PdmCache;
  } catch (e) {
    console.warn('Erro ao buscar PDM do cache:', e);
    return null;
  }
}

/**
 * Busca um CATSER do cache local.
 */
export async function getServicoFromCache(codigoServico: number): Promise<ServicoCache | null> {
  if (!(codigoServico > 0)) return null;
  try {
    const snap = await getDoc(doc(db, 'catalogo_servicos', String(codigoServico)));
    if (!snap.exists()) return null;
    return snap.data() as ServicoCache;
  } catch (e) {
    console.warn('Erro ao buscar CATSER do cache:', e);
    return null;
  }
}

/**
 * Conta quantos PDMs e CATSERs estao cacheados localmente.
 * Util pra mostrar estatistica no painel admin.
 */
export async function getCatalogoStats(): Promise<{ pdmsCached: number; servicosCached: number; ultimaSync: Date | null }> {
  try {
    const [pdmsSnap, servSnap, ultimoPdmSnap] = await Promise.all([
      getDocs(query(collection(db, 'catalogo_pdms'))),
      getDocs(query(collection(db, 'catalogo_servicos'))),
      getDocs(query(collection(db, 'catalogo_pdms'), orderBy('sincronizadoEm', 'desc'), limit(1))),
    ]);
    let ultimaSync: Date | null = null;
    if (!ultimoPdmSnap.empty) {
      const ts = ultimoPdmSnap.docs[0].data().sincronizadoEm as Timestamp | undefined;
      if (ts && typeof ts.toDate === 'function') ultimaSync = ts.toDate();
    }
    return {
      pdmsCached: pdmsSnap.size,
      servicosCached: servSnap.size,
      ultimaSync,
    };
  } catch (e) {
    console.warn('Erro ao contar catalogo:', e);
    return { pdmsCached: 0, servicosCached: 0, ultimaSync: null };
  }
}

/**
 * Procura PDMs cacheados que ja contem um determinado codigoItem (CATMAT) nos itens vinculados.
 * Util pra resolver "esse item esta cacheado?" sem precisar baixar de novo.
 *
 * Nota: usa where('itensVinculados', 'array-contains', ...) que NAO funciona em objetos
 * aninhados. Por isso fazemos scan e filtramos no cliente. Tolerável pra ~100 PDMs cacheados.
 */
export async function findPdmByItem(codigoCatmat: number): Promise<PdmCache | null> {
  if (!(codigoCatmat > 0)) return null;
  try {
    const snap = await getDocs(collection(db, 'catalogo_pdms'));
    for (const docSnap of snap.docs) {
      const pdm = docSnap.data() as PdmCache;
      if (pdm.itensVinculados?.some(it => it.codigoItem === codigoCatmat)) {
        return pdm;
      }
    }
    return null;
  } catch (e) {
    console.warn('Erro em findPdmByItem:', e);
    return null;
  }
}
