// ============================================================================
// LIE — Cliente do Assistente de Plano de Trabalho com IA (Cloud Function Gemini)
// ============================================================================
//
// Fase A: gera os campos narrativos do plano de trabalho a partir de um brief
// curto + contexto do projeto/entidade. Ver functions/src/index.ts (gerarPlanoTrabalho).

import { storage } from './firebase';

export interface PlanoIaInput {
  titulo: string;
  brief?: string;
  modalidades?: string[];
  publicoAlvo?: string;
  local?: string;
  periodoMeses?: number;
  mesInicio?: string;
  mesTermino?: string;
  historicoEntidade?: string;
  entidadeNome?: string;
  instrumentoOrigem?: string;
}

export interface MetaIa {
  meta: string;
  indicador: string;
  formula: string;
  verificacao: string;
}

export interface AcaoIa {
  acao: string;
  descricao: string;
  mesInicio: string;
  mesTermino: string;
}

export interface PlanoIaNarrativo {
  resumo: string;
  objetivoGeral: string;
  objetivosEspecificos: string[];
  justificativa: string;
  caracterizacaoSocioeconomica: string;
  metodologia: string;
  planoDivulgacao: string;
  metasQualitativas: MetaIa[];
  metasQuantitativas: MetaIa[];
  cronograma: AcaoIa[];
}

/**
 * Gera os campos narrativos do plano de trabalho via Gemini.
 * Lança Error com mensagem amigável em caso de falha (pra UI exibir).
 */
export async function gerarPlanoComIA(input: PlanoIaInput): Promise<PlanoIaNarrativo> {
  const projectId = storage.app.options.projectId;
  const url = `https://us-central1-${projectId}.cloudfunctions.net/gerarPlanoTrabalho`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!resp.ok) {
    let msg = `Falha ao gerar (HTTP ${resp.status}).`;
    try {
      const j = await resp.json();
      if (j?.error) msg = j.error;
    } catch { /* ignora */ }
    throw new Error(msg);
  }

  return await resp.json();
}

export interface MemorialIaInput {
  itemNome: string;
  unidade?: string;
  valorUnitario?: number;
  quantidadeTotal?: number;
  distribuicao?: string;
  tituloProjeto?: string;
  publicoAlvo?: string;
  modalidades?: string[];
  periodoMeses?: number;
  medianaReferencia?: number;
}

/** Gera o memorial de cálculo de um item do orçamento via Gemini. */
export async function gerarMemorialCalculo(input: MemorialIaInput): Promise<string> {
  const projectId = storage.app.options.projectId;
  const url = `https://us-central1-${projectId}.cloudfunctions.net/gerarMemorialCalculo`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!resp.ok) {
    let msg = `Falha ao gerar memorial (HTTP ${resp.status}).`;
    try { const j = await resp.json(); if (j?.error) msg = j.error; } catch { /* ignora */ }
    throw new Error(msg);
  }
  const j = await resp.json();
  return String(j?.memorial || '');
}

export interface PrestacaoIaInput {
  tituloProjeto: string;
  objetivoGeral?: string;
  periodo?: string;
  publicoAlvo?: string;
  modalidades?: string[];
  metasQualitativas?: { meta: string; indicador: string; verificacao: string }[];
  metasQuantitativas?: { meta: string; indicador: string; verificacao: string }[];
  demonstrativo?: string;
  totalOrcado?: number;
  totalExecutado?: number;
  saldoDevolver?: number;
  remanejamento?: string;
}
export interface PrestacaoIaNarrativa { resumoExecutivo: string; metasAtingidas: string; dificuldades: string; }

/** Gera a narrativa da prestação de contas (cumprimento do objeto) via Gemini. */
export async function gerarPrestacaoContas(input: PrestacaoIaInput): Promise<PrestacaoIaNarrativa> {
  const projectId = storage.app.options.projectId;
  const url = `https://us-central1-${projectId}.cloudfunctions.net/gerarPrestacaoContas`;
  const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  if (!resp.ok) {
    let msg = `Falha ao gerar narrativa (HTTP ${resp.status}).`;
    try { const j = await resp.json(); if (j?.error) msg = j.error; } catch { /* ignora */ }
    throw new Error(msg);
  }
  return await resp.json();
}
