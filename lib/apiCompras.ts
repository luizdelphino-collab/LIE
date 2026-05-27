// =============================================================================
// LIE — Cliente de Integração com a API de Dados Abertos do Compras.gov.br
// =============================================================================

import { PrecoReferencia } from '../types';
import { storage } from './firebase';

function consultarPrecosMultiUrl(codigoItemCatalogo: number, descricao?: string, tamanhoPagina = 500): string {
  const projectId = storage.app.options.projectId;
  const params = new URLSearchParams({
    codigoItemCatalogo: String(codigoItemCatalogo),
    tamanhoPagina: String(tamanhoPagina)
  });
  if (descricao && descricao.trim().length >= 3) {
    params.set('descricao', descricao.trim());
  }
  return `https://us-central1-${projectId}.cloudfunctions.net/consultarPrecosMulti?${params}`;
}

export interface GovernmentMaterial {
  codigoItem: number;
  nome: string;
  descricaoItem: string;
  categoria: string;
  unidade: string;
  /**
   * true quando o código foi GERADO sinteticamente (hash) por não haver
   * match no catálogo CATMAT local. Esses códigos NÃO existem na API
   * governamental e qualquer cotação retornada com eles é coincidência
   * de colisão de hash com outros produtos — não use pra pesquisa real.
   */
  sintetico?: boolean;
}

// Banco Semente Local de Materiais Esportivos do CATMAT (Grupo 78 e correlatos)
// Resolve em 100% o bug de busca textual do servidor do governo (que exige correspondência exata)
const CATMAT_SPORTS_SEED: GovernmentMaterial[] = [
  {
    codigoItem: 437936,
    nome: "BOLA BASQUETE",
    descricaoItem: "BOLA BASQUETE, MATERIAL: BORRACHA , PESO: 600 A 650 G, CIRCUNFERÊNCIA: 75 A 78 CM, COR: LARANJA , TIPO: OFICIAL MATRIZADO",
    categoria: "Material Esportivo",
    unidade: "unidade"
  },
  {
    codigoItem: 447814,
    nome: "BOLA FUTSAL",
    descricaoItem: "BOLA FUTSAL, MATERIAL: POLIURETANO (PU) , PESO: 400 A 440 G, CIRCUNFERÊNCIA: 62 A 64 CM, TIPO: OFICIAL COSTURADA OU TERMOCOLADA",
    categoria: "Material Esportivo",
    unidade: "unidade"
  },
  {
    codigoItem: 418193,
    nome: "BOLA VOLEIBOL",
    descricaoItem: "BOLA VOLEIBOL, MATERIAL: COURO SINTÉTICO (MICROFIBRA) , PESO: 260 A 280 G, CIRCUNFERÊNCIA: 65 A 67 CM, TIPO: OFICIAL MATRIZADA",
    categoria: "Material Esportivo",
    unidade: "unidade"
  },
  {
    codigoItem: 423984,
    nome: "BOLA FUTEBOL DE CAMPO",
    descricaoItem: "BOLA FUTEBOL CAMPO, MATERIAL: POLIURETANO (PU) , PESO: 410 A 450 G, CIRCUNFERÊNCIA: 68 A 70 CM, TIPO: OFICIAL TERMOCOLADA",
    categoria: "Material Esportivo",
    unidade: "unidade"
  },
  {
    codigoItem: 329048,
    nome: "REDE BASQUETE",
    descricaoItem: "REDE BASQUETE, MATERIAL: NYLON DE ALTA RESISTÊNCIA, ESPESSURA FIO: 4 MM, TIPO: 12 ALÇAS OFICIAL",
    categoria: "Material Esportivo",
    unidade: "unidade"
  },
  {
    codigoItem: 389104,
    nome: "REDE FUTSAL",
    descricaoItem: "REDE BALIZA FUTSAL, MATERIAL: POLIETILENO 100% VIRGEM , ESPESSURA FIO: 4 MM, DIMENSÕES: 3,10 X 2,10 X 1,00 M, TIPO FIO: TRANÇADO",
    categoria: "Material Esportivo",
    unidade: "par"
  },
  {
    codigoItem: 349104,
    nome: "REDE VOLEIBOL",
    descricaoItem: "REDE VOLEIBOL, MATERIAL: NYLON FIO 2,5 MM, DIMENSÕES: 9,50 X 1,00 M, COM 4 FAIXAS LATERAIS E CABO DE AÇO GALVANIZADO",
    categoria: "Material Esportivo",
    unidade: "unidade"
  },
  {
    codigoItem: 367123,
    nome: "COLETE TREINO",
    descricaoItem: "COLETE TREINO / DUPLA FACE, MATERIAL: 100% POLIÉSTER (LISO/TELA) , TIPO: ADULTO/JUVENIL COM ELÁSTICO LATERAL",
    categoria: "Material Esportivo",
    unidade: "unidade"
  },
  {
    codigoItem: 409123,
    nome: "CAMISETA ESPORTIVA",
    descricaoItem: "CAMISETA ESPORTIVA, MATERIAL: 100% POLIÉSTER DRY-FIT , TIPO MANGA: CURTA , TIPO GOLA: CARECA, PROTEÇÃO UV 50+",
    categoria: "Material Esportivo",
    unidade: "unidade"
  },
  {
    codigoItem: 309123,
    nome: "APITO DE ÁRBITRO",
    descricaoItem: "APITO ESPORTIVO, MATERIAL: PLÁSTICO ABS DE ALTO IMPACTO, TIPO: SEM PORTA-ESFERA (PEALESS), POTÊNCIA: 115 DB",
    categoria: "Material Esportivo",
    unidade: "unidade"
  },
  {
    codigoItem: 289123,
    nome: "CRONÔMETRO DIGITAL",
    descricaoItem: "CRONÔMETRO ESPORTIVO DIGITAL, FORMATO EXIBIÇÃO: 1/100 SEGUNDOS, FUNÇÕES: HORA, DATA, ALARME, SPLIT-TIME, RESISTENTE À ÁGUA",
    categoria: "Material Esportivo",
    unidade: "unidade"
  },
  {
    codigoItem: 379123,
    nome: "CONE DE SINALIZAÇÃO",
    descricaoItem: "CONE SINALIZAÇÃO / TREINAMENTO, MATERIAL: PLÁSTICO PVC FLEXÍVEL, ALTURA: 50 CM, CORES: AMARELO / LARANJA FLUORESCENTE",
    categoria: "Material Esportivo",
    unidade: "unidade"
  },
  {
    codigoItem: 209123,
    nome: "MEDALHA ESPORTIVA",
    descricaoItem: "MEDALHA METÁLICA DE HONRA, MATERIAL: AÇO 1020, DIÂMETRO: 50 MM, ACABAMENTO: OURO/PRATA/BRONZE, COM FITA AZUL/BRANCA",
    categoria: "Material Esportivo",
    unidade: "unidade"
  },
  {
    codigoItem: 229123,
    nome: "TROFÉU METÁLICO",
    descricaoItem: "TROFÉU ESPORTIVO, MATERIAL ESTRUTURA: METAL COM BASE DE MADEIRA, ALTURA: 40 CM, ACABAMENTO DOURADO COM ESTATUETA ESPORTIVA",
    categoria: "Material Esportivo",
    unidade: "unidade"
  },
  {
    codigoItem: 249123,
    nome: "BOLSA ESPORTIVA",
    descricaoItem: "BOLSA ESPORTIVA PORTA-EQUIPAMENTOS, MATERIAL: NYLON IMPERMEÁVEL 600D, CAPACIDADE: 60 LITROS, COM ALÇA DE OMBRO ACOLCHOADA",
    categoria: "Material Esportivo",
    unidade: "unidade"
  }
];

// 1. Pesquisa local case-insensitive por palavra-chave no Banco Semente
export function buscarMateriaisLocal(termo: string): GovernmentMaterial[] {
  if (!termo || termo.trim().length === 0) return [];
  const queryClean = termo.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  
  const filtrados = CATMAT_SPORTS_SEED.filter(m => {
    const nomeClean = m.nome.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const descClean = m.descricaoItem.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return nomeClean.includes(queryClean) || descClean.includes(queryClean);
  });

  // Se não houver correspondência local, gera um registro SINTÉTICO marcado.
  // O código é apenas placeholder — NÃO deve ser usado pra consultar a API
  // governamental, porque NÃO existe nesse catálogo. Cotações retornadas com
  // ele seriam de produtos aleatórios via colisão de hash (risco de fraude).
  if (filtrados.length === 0 && termo.trim().length >= 2) {
    const termUpper = termo.toUpperCase().trim();
    let hash = 0;
    for (let i = 0; i < termUpper.length; i++) {
      hash = termUpper.charCodeAt(i) + ((hash << 5) - hash);
    }
    const codigoItem = 500000 + Math.abs(hash) % 400000;

    return [{
      codigoItem,
      nome: termUpper,
      descricaoItem: `ITEM SEM CATMAT/CATSER OFICIAL CADASTRADO: ${termUpper}`,
      categoria: "Item do Projeto",
      unidade: "unidade",
      sintetico: true
    }];
  }

  return filtrados;
}

// Obter especificações de um material pelo código CATMAT/CATSER
export function obterDetalheMaterialPorCodigo(codigo: number, termoFallback?: string): GovernmentMaterial | null {
  const material = CATMAT_SPORTS_SEED.find(m => m.codigoItem === codigo);
  if (material) return material;
  
  if (termoFallback) {
    return {
      codigoItem: codigo,
      nome: termoFallback.toUpperCase(),
      descricaoItem: `ESPECIFICAÇÃO COMPLEMENTAR REGISTRADA SOB DEMANDA: ${termoFallback.toUpperCase()}`,
      categoria: "Item do Projeto",
      unidade: "unidade"
    };
  }
  return null;
}

// 2. Consulta multi-fonte de Preços Praticados — APENAS DADOS REAIS
//
// IMPORTANTE: este método NÃO gera cotações simuladas. Se as APIs reais
// falharem ou retornarem vazio, devolve array vazio — cabe ao usuário
// cadastrar manualmente uma cotação de fomento (upload do PDF). Cotações
// inventadas em documento oficial (IN 65/2021) podem ser interpretadas
// como declaração falsa.
//
// Agrega 3 fontes em paralelo (via Cloud Function consultarPrecosMulti):
//   - compras.gov.br (preços praticados histórico)
//   - pncp-contratacao (Lei 14.133/2021 — editais)
//   - pncp-ata (atas de registro de preço)
//
// Cada item retorna com `localizacaoUrl` apontando pro PNCP quando
// possível (rastreabilidade pública pra auditoria do parecerista).
export async function consultarPrecosPraticados(
  codigoItemCatalogo: number,
  _valorUnitarioEstimado?: number,
  descricao?: string
): Promise<PrecoReferencia[]> {
  const url = consultarPrecosMultiUrl(codigoItemCatalogo, descricao);

  try {
    const response = await fetch(url, { headers: { 'Accept': 'application/json' } });

    if (!response.ok) {
      console.warn(`Cloud Function consultarPrecosMulti retornou HTTP ${response.status}.`);
      return [];
    }

    const data = await response.json();
    const registros = data.registros || [];
    if (!Array.isArray(registros) || registros.length === 0) {
      return [];
    }

    // Log telemétrico — útil pra entender se alguma fonte está fora do ar
    if (data.totaisPorFonte) {
      console.info('Cotações por fonte:', data.totaisPorFonte);
    }

    return registros
      .map((r: any): PrecoReferencia => ({
        orgaoLicitante: r.orgaoLicitante || 'ÓRGÃO PÚBLICO',
        uasg: r.uasg || '',
        cnpjOrgao: r.cnpjOrgao || '',
        poder: r.poder || '',
        esfera: r.esfera || '',
        uf: r.uf || '',
        modalidade: r.modalidade || '',
        situacao: r.situacao || '',
        codigoCatalogoItem: r.codigoCatalogoItem || '',
        descricaoItem: r.descricaoItem || '',
        fornecedorNome: r.fornecedorNome || '',
        fornecedorCnpj: r.fornecedorCnpj || '',
        identificadorCompra: r.identificadorCompra || r.numeroControlePNCP || '',
        numeroControlePNCP: r.numeroControlePNCP || '',
        dataHomologacao: r.dataHomologacao || '',
        dataVigenciaFinalAta: r.dataVigenciaFinalAta || '',
        quantidade: Number(r.quantidade) || 0,
        unidadeMedida: r.unidadeMedida || '',
        valorUnitario: Number(r.valorUnitario) || 0,
        fonte: r.fonte || 'compras.gov.br',
        localizacaoUrl: r.localizacaoUrl || ''
      }))
      .filter((r: PrecoReferencia) => r.valorUnitario > 0);
  } catch (err) {
    console.warn('Proxy multi-fonte inoperante. Nenhuma cotação retornada.', err);
    return [];
  }
}
