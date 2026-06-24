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
  historicoEntidade?: string;
  entidadeNome?: string;
  instrumentoOrigem?: string;
}

export interface PlanoIaNarrativo {
  resumo: string;
  objetivoGeral: string;
  objetivosEspecificos: string[];
  justificativa: string;
  caracterizacaoSocioeconomica: string;
  metodologia: string;
  planoDivulgacao: string;
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
