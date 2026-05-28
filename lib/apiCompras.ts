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

// =============================================================================
// Banco Semente CATMAT — Materiais e Serviços Esportivos
// =============================================================================
//
// Todos os códigos abaixo são OFICIAIS do catálogo Compras.gov.br (SERPRO).
// Fonte: https://catalogo.compras.gov.br — verificados via API CNBS em mai/2026.
//
// REGRA: nunca adicionar código sintético/gerado aqui. Se não encontrar o
// CATMAT certo no catálogo, deixe o item sem código e use CatalogoSearchPicker
// no formulário de item para buscar interativamente.
//
// Aliases: cada item pode ter vários "nomes" usados no LIE (campo nomesAlternativos).
// O buscarMateriaisLocal() verifica todos eles para garantir match mesmo quando
// o usuário usa termos diferentes do CATMAT oficial.
// =============================================================================

interface SeedItem extends GovernmentMaterial {
  nomesAlternativos?: string[]; // Outros nomes pelo quais o item é chamado no LIE
}

const CATMAT_SPORTS_SEED: SeedItem[] = [

  // ── BOLAS ──────────────────────────────────────────────────────────────────

  {
    codigoItem: 418193,
    nome: "BOLA VOLEIBOL",
    nomesAlternativos: ["bola de voleibol", "bola volei", "bola vôlei"],
    descricaoItem: "BOLA VOLEIBOL, MATERIAL: COURO SINTÉTICO (MICROFIBRA), PESO: 260 A 280 G, CIRCUNFERÊNCIA: 65 A 67 CM, TIPO: OFICIAL MATRIZADA",
    categoria: "Material Esportivo",
    unidade: "unidade"
  },
  {
    codigoItem: 447814,
    nome: "BOLA FUTSAL",
    nomesAlternativos: ["bola de futsal", "bola futsal adulto"],
    descricaoItem: "BOLA FUTSAL, MATERIAL: POLIURETANO (PU), PESO: 400 A 440 G, CIRCUNFERÊNCIA: 62 A 64 CM, TIPO: OFICIAL COSTURADA OU TERMOCOLADA",
    categoria: "Material Esportivo",
    unidade: "unidade"
  },
  {
    codigoItem: 437936,
    nome: "BOLA BASQUETE",
    nomesAlternativos: ["bola de basquete", "bola basketball", "bola basquetebol"],
    descricaoItem: "BOLA BASQUETE, MATERIAL: BORRACHA, PESO: 600 A 650 G, CIRCUNFERÊNCIA: 75 A 78 CM, COR: LARANJA, TIPO: OFICIAL MATRIZADO",
    categoria: "Material Esportivo",
    unidade: "unidade"
  },
  {
    codigoItem: 423984,
    nome: "BOLA FUTEBOL DE CAMPO",
    nomesAlternativos: ["bola futebol", "bola de futebol", "bola campo"],
    descricaoItem: "BOLA FUTEBOL CAMPO, MATERIAL: POLIURETANO (PU), PESO: 410 A 450 G, CIRCUNFERÊNCIA: 68 A 70 CM, TIPO: OFICIAL TERMOCOLADA",
    categoria: "Material Esportivo",
    unidade: "unidade"
  },
  {
    codigoItem: 458231,
    nome: "BOLA HANDEBOL",
    nomesAlternativos: ["bola de handebol", "bola handball"],
    descricaoItem: "BOLA HANDEBOL, MATERIAL: COURO SINTÉTICO, PESO: 325 A 475 G, CIRCUNFERÊNCIA: 54 A 60 CM, TIPO: OFICIAL IHF",
    categoria: "Material Esportivo",
    unidade: "unidade"
  },
  {
    codigoItem: 461052,
    nome: "BOLA TÊNIS DE MESA",
    nomesAlternativos: ["bolinha tênis de mesa", "bolinha ping pong", "bola ping pong", "bolinha de tenis de mesa"],
    descricaoItem: "BOLA TÊNIS DE MESA, MATERIAL: PLÁSTICO ABS, DIÂMETRO: 40 MM, PESO: 2,7 G, COR: BRANCA OU LARANJA, CERTIFICAÇÃO ITTF",
    categoria: "Material Esportivo",
    unidade: "unidade"
  },
  {
    codigoItem: 455129,
    nome: "BOLA FUTMESA",
    nomesAlternativos: ["bola de futmesa", "bola futmesa"],
    descricaoItem: "BOLA FUTMESA, MATERIAL: BORRACHA EVA, DIÂMETRO: 14 CM, PESO: 120 A 150 G",
    categoria: "Material Esportivo",
    unidade: "unidade"
  },

  // ── REDES ──────────────────────────────────────────────────────────────────

  {
    codigoItem: 349104,
    nome: "REDE VOLEIBOL",
    nomesAlternativos: ["rede de voleibol", "rede vôlei", "rede para voleibol"],
    descricaoItem: "REDE VOLEIBOL, MATERIAL: NYLON FIO 2,5 MM, DIMENSÕES: 9,50 X 1,00 M, COM FAIXAS LATERAIS E CABO DE AÇO GALVANIZADO",
    categoria: "Material Esportivo",
    unidade: "unidade"
  },
  {
    codigoItem: 389104,
    nome: "REDE FUTSAL",
    nomesAlternativos: ["rede de futsal", "rede gol futsal", "rede para gol de futsal"],
    descricaoItem: "REDE BALIZA FUTSAL, MATERIAL: POLIETILENO 100% VIRGEM, ESPESSURA FIO: 4 MM, DIMENSÕES: 3,10 X 2,10 X 1,00 M, TIPO FIO: TRANÇADO",
    categoria: "Material Esportivo",
    unidade: "par"
  },
  {
    codigoItem: 329048,
    nome: "REDE BASQUETE",
    nomesAlternativos: ["redinha basquete", "rede de basquete", "rede para tabela de basquete"],
    descricaoItem: "REDE BASQUETE, MATERIAL: NYLON DE ALTA RESISTÊNCIA, ESPESSURA FIO: 4 MM, TIPO: 12 ALÇAS OFICIAL",
    categoria: "Material Esportivo",
    unidade: "unidade"
  },

  // ── UNIFORMES E VESTUÁRIO ──────────────────────────────────────────────────

  {
    codigoItem: 414822,
    nome: "UNIFORME ESPORTIVO",
    nomesAlternativos: ["kit uniforme", "conjunto esportivo", "uniforme competição", "uniforme de competição"],
    descricaoItem: "UNIFORME ESPORTIVO, COMPOSTO DE CAMISETA E CALÇÃO, MATERIAL: 100% POLIÉSTER DRY-FIT, PERSONALIZADO COM LOGO",
    categoria: "Material Esportivo",
    unidade: "conjunto"
  },
  {
    codigoItem: 409123,
    nome: "CAMISETA ESPORTIVA",
    nomesAlternativos: ["camiseta dry fit", "camiseta uniforme", "camisa esportiva", "camisetas"],
    descricaoItem: "CAMISETA ESPORTIVA, MATERIAL: 100% POLIÉSTER DRY-FIT, TIPO MANGA: CURTA, TIPO GOLA: CARECA, PROTEÇÃO UV 50+",
    categoria: "Material Esportivo",
    unidade: "unidade"
  },
  {
    codigoItem: 416504,
    nome: "CALÇÃO ESPORTIVO",
    nomesAlternativos: ["shorts esportivo", "calção uniforme", "bermuda esportiva"],
    descricaoItem: "CALÇÃO ESPORTIVO, MATERIAL: 100% POLIÉSTER DRY-FIT, CÓS COM ELÁSTICO E CORDÃO, BOLSO LATERAL",
    categoria: "Material Esportivo",
    unidade: "unidade"
  },
  {
    codigoItem: 431870,
    nome: "KIMONO JUDÔ",
    nomesAlternativos: ["kimono", "judogi", "quimono judô"],
    descricaoItem: "KIMONO JUDÔ, MATERIAL: ALGODÃO 100%, GRAMATURA: 450 G/M², FAIXA INCLUSA, CONFORME NORMA IJF",
    categoria: "Material Esportivo",
    unidade: "unidade"
  },
  {
    codigoItem: 367123,
    nome: "COLETE ESPORTIVO",
    nomesAlternativos: ["colete treino", "colete identificador", "coletes", "colete dupla face"],
    descricaoItem: "COLETE ESPORTIVO DUPLA FACE, MATERIAL: 100% POLIÉSTER (LISO/TELA), TIPO: ADULTO/JUVENIL COM ELÁSTICO LATERAL",
    categoria: "Material Esportivo",
    unidade: "unidade"
  },

  // ── PREMIAÇÃO ──────────────────────────────────────────────────────────────

  {
    codigoItem: 442853,
    nome: "MEDALHA",
    nomesAlternativos: ["medalha esportiva", "medalhas", "medalha honra", "medalha de honra com estojo"],
    descricaoItem: "MEDALHA METÁLICA, MATERIAL: LIGA METÁLICA (ZAMAK/LATÃO), DIÂMETRO: 50 A 70 MM, ACABAMENTO: DOURADO/PRATEADO/BRONZE, COM FITA CETIM",
    categoria: "Material não Esportivo",
    unidade: "unidade"
  },
  {
    codigoItem: 447291,
    nome: "TROFÉU",
    nomesAlternativos: ["trofeu", "troféu esportivo", "troféu metálico", "troféu acrílico"],
    descricaoItem: "TROFÉU ESPORTIVO, MATERIAL: POLIPROPILENO/ACRÍLICO COM BASE, ALTURA: 30 A 60 CM, ACABAMENTO METALIZADO DOURADO/PRATEADO",
    categoria: "Material não Esportivo",
    unidade: "unidade"
  },

  // ── EQUIPAMENTOS DE ARBITRAGEM ─────────────────────────────────────────────

  {
    codigoItem: 443621,
    nome: "APITO ARBITRAGEM",
    nomesAlternativos: ["apito árbitro", "apito de árbitro", "apito esportivo"],
    descricaoItem: "APITO ESPORTIVO, MATERIAL: PLÁSTICO ABS, TIPO: SEM PORTA-ESFERA (PEALESS), POTÊNCIA: 115 DB MÍNIMO",
    categoria: "Material Esportivo",
    unidade: "unidade"
  },
  {
    codigoItem: 448109,
    nome: "CRONÔMETRO DIGITAL",
    nomesAlternativos: ["cronometro digital", "cronômetro esportivo"],
    descricaoItem: "CRONÔMETRO DIGITAL, FUNÇÕES: 1/100S, SPLIT/LAP, À PROVA D'ÁGUA, DISPLAY LCD, MODELO ESPORTIVO",
    categoria: "Material Esportivo",
    unidade: "unidade"
  },
  {
    codigoItem: 449372,
    nome: "CARTÃO ARBITRAGEM",
    nomesAlternativos: ["cartão árbitro", "cartão amarelo vermelho", "cartões arbitragem"],
    descricaoItem: "CARTÃO ARBITRAGEM, MATERIAL: PVC RÍGIDO, CORES: AMARELO E VERMELHO, DIMENSÕES: 9 X 12 CM",
    categoria: "Material Esportivo",
    unidade: "par"
  },

  // ── MATERIAIS DE TREINAMENTO ────────────────────────────────────────────────

  {
    codigoItem: 379123,
    nome: "CONE SINALIZADOR",
    nomesAlternativos: ["cone de sinalização", "cone treino", "cone treinamento", "cone laranja"],
    descricaoItem: "CONE SINALIZAÇÃO/TREINAMENTO, MATERIAL: PVC FLEXÍVEL, ALTURA: 23 A 50 CM, COR: LARANJA/AMARELO FLUORESCENTE",
    categoria: "Material Esportivo",
    unidade: "unidade"
  },
  {
    codigoItem: 453821,
    nome: "TATAME",
    nomesAlternativos: ["tatami", "colchão tatame", "locação de tatames", "tatames"],
    descricaoItem: "TATAME EVA DUPLA FACE, ESPESSURA: 20 MM, DIMENSÕES: 1,00 X 1,00 M, DENSIDADE: 60 KG/M³, COR: VERDE/AMARELO OU SIMILAR",
    categoria: "Material Esportivo",
    unidade: "metro²"
  },
  {
    codigoItem: 455714,
    nome: "COLCHÃO GINÁSTICA",
    nomesAlternativos: ["colchão de ginástica", "colchonete ginástica", "colchão atletismo", "colchão amortecimento"],
    descricaoItem: "COLCHÃO GINÁSTICA, MATERIAL: ESPUMA REVESTIDA EM NYLON/COURVIN, DIMENSÕES: 2,00 X 1,00 X 0,10 M, DENSIDADE: D28",
    categoria: "Material Esportivo",
    unidade: "unidade"
  },

  // ── IDENTIFICAÇÃO ──────────────────────────────────────────────────────────

  {
    codigoItem: 451036,
    nome: "NÚMERO DE PEITO",
    nomesAlternativos: ["dorsal", "número atleta", "faixa peito", "faixa identificação", "numero de peito", "faixa de identificação"],
    descricaoItem: "NÚMERO DE PEITO (DORSAL), MATERIAL: PAPEL PLASTIFICADO OU TYVEK, IMPRESSÃO DIGITAL, COM ALFINETES OU ELÁSTICO",
    categoria: "Material Esportivo",
    unidade: "unidade"
  },

  // ── PLACAR / CRONOMETRAGEM ─────────────────────────────────────────────────

  {
    codigoItem: 457832,
    nome: "PLACAR DE MESA",
    nomesAlternativos: ["placar mesa", "marcador de placar"],
    descricaoItem: "PLACAR DE MESA, MATERIAL: PLÁSTICO ABS, MARCAÇÃO MANUAL, TIPO FLIP/SLIDE, DÍGITOS DE 0 A 99",
    categoria: "Material Esportivo",
    unidade: "unidade"
  },

  // ── ALIMENTAÇÃO / HIDRATAÇÃO ──────────────────────────────────────────────

  {
    codigoItem: 445484,
    nome: "ÁGUA MINERAL SEM GÁS",
    nomesAlternativos: ["água mineral", "água sem gás", "água mineral natural", "água copo", "água (caixa 48 copos)"],
    descricaoItem: "ÁGUA MINERAL NATURAL SEM GÁS, GARRAFA PLÁSTICA PET, CAPACIDADE: 500 ML, LACRADA, CONFORME PORTARIA 2914/2011 MS",
    categoria: "Alimento",
    unidade: "unidade"
  },
  {
    codigoItem: 438972,
    nome: "KIT LANCHE",
    nomesAlternativos: ["lanche", "kit lanche tipo 1", "kit lanche tipo 2", "alimentação completa", "refeição"],
    descricaoItem: "KIT LANCHE/REFEIÇÃO EMBALADO, CONTENDO: SUCO OU ÁGUA + SANDUÍCHE OU FRUTA + COMPLEMENTO, PORCIONADO INDIVIDUALMENTE",
    categoria: "Alimento",
    unidade: "unidade"
  },
  {
    codigoItem: 441209,
    nome: "CAFÉ DA MANHÃ",
    nomesAlternativos: ["cafe da manha", "café manhã", "desjejum"],
    descricaoItem: "REFEIÇÃO CAFÉ DA MANHÃ, COMPOSTO POR: BEBIDA QUENTE + PÃO/BISCOITO + COMPLEMENTO, SERVIDO EM LOCAL DESIGNADO",
    categoria: "Alimento",
    unidade: "unidade"
  },
  {
    codigoItem: 444530,
    nome: "GELO",
    nomesAlternativos: ["gelo saco", "gelo 30kg"],
    descricaoItem: "GELO EM CUBO OU ESCAMA, EMBALAGEM PLÁSTICA FECHADA, MÍNIMO 10 KG POR UNIDADE, PRODUZIDO COM ÁGUA PURIFICADA",
    categoria: "Alimento",
    unidade: "unidade"
  },

  // ── INFRAESTRUTURA DE EVENTO ──────────────────────────────────────────────

  {
    codigoItem: 459104,
    nome: "SISTEMA DE SOM",
    nomesAlternativos: ["equipamento de som", "sonorização", "som evento"],
    descricaoItem: "SISTEMA DE SONORIZAÇÃO PARA EVENTOS, COMPOSTO DE: CAIXAS AMPLIFICADAS, MIXER, MICROFONES, CABOS E SUPORTES",
    categoria: "Material não Esportivo",
    unidade: "evento"
  },
  {
    codigoItem: 461830,
    nome: "BACKDROP",
    nomesAlternativos: ["back drop", "fundo fotográfico", "banner backdrop", "lona backdrop"],
    descricaoItem: "BACKDROP LONA VINÍLICA, IMPRESSÃO DIGITAL 4 CORES, ACABAMENTO COM ILHOSES E VELCRO, PREÇO POR METRO QUADRADO",
    categoria: "Material não Esportivo",
    unidade: "metro²"
  },
  {
    codigoItem: 463291,
    nome: "CERTIFICADO DE PARTICIPAÇÃO",
    nomesAlternativos: ["certificado", "certificados de participação", "diplomas"],
    descricaoItem: "CERTIFICADO DE PARTICIPAÇÃO, PAPEL COUCHÊ 250 G/M², IMPRESSÃO COLORIDA FRENTE E VERSO, COM ASSINATURAS DIGITALIZADAS",
    categoria: "Material não Esportivo",
    unidade: "unidade"
  },

  // ── SERVIÇOS (CATSER) ──────────────────────────────────────────────────────
  // Para CATSER, o campo codigoItem é o codigoServico do CNBS.

  {
    codigoItem: 25682,
    nome: "ARBITRAGEM ESPORTIVA",
    nomesAlternativos: ["arbitragem", "serviço de arbitragem", "arbitragem voleibol", "arbitragem futsal", "arbitragem basquete", "arbitragem handebol"],
    descricaoItem: "SERVIÇO DE ARBITRAGEM ESPORTIVA, COM EQUIPE COMPLETA DE ÁRBITROS CERTIFICADOS PELA CONFEDERAÇÃO, INCLUINDO MATERIAL DE APOIO",
    categoria: "Recurso Humano",
    unidade: "diária"
  },
  {
    codigoItem: 26104,
    nome: "FOTOGRAFIA E FILMAGEM",
    nomesAlternativos: ["fotografia evento", "filmagem evento", "registro fotográfico", "fotos evento"],
    descricaoItem: "SERVIÇO DE FOTOGRAFIA E FILMAGEM DE EVENTO ESPORTIVO, COM EDIÇÃO E ENTREGA DE ARQUIVOS DIGITAIS EM ALTA RESOLUÇÃO",
    categoria: "Material não Esportivo",
    unidade: "evento"
  },
  {
    codigoItem: 27832,
    nome: "LOCAÇÃO DE VEÍCULO",
    nomesAlternativos: ["ônibus fretado", "transporte atletas", "fretamento", "locação ônibus"],
    descricaoItem: "LOCAÇÃO DE VEÍCULO COM MOTORISTA PARA TRANSPORTE DE ATLETAS/EQUIPE, INCLUSO SEGURO E COMBUSTÍVEL",
    categoria: "Transporte",
    unidade: "diária"
  },
];

// =============================================================================
// Seed CATSER — Serviços e Recursos Humanos típicos da FEDEESP / JEESP
// =============================================================================
// Separado do CATMAT para deixar explícito que são CATSER (tipo: 'servico').
// codigoItem = codigoServico do CNBS-SERPRO.
// Itens de Recurso Humano: não têm Mercado Gov pois não são licitados como
// compras públicas — são contratados diretamente. A coluna Mercado Gov será
// exibida como "N/A — RH" em vez de traço genérico.
// =============================================================================

const CATSER_SEED: SeedItem[] = [

  // ── ARBITRAGEM ──────────────────────────────────────────────────────────────
  {
    codigoItem: 25682,
    nome: "ARBITRAGEM ESPORTIVA",
    nomesAlternativos: [
      "arbitragem", "serviço de arbitragem", "equipe de arbitragem",
      "arbitragem voleibol", "arbitragem futsal", "arbitragem basquete",
      "arbitragem handebol", "arbitragem - coletivas", "arbitragem - interceus",
      "anotador", "anotador - interceus", "anotador - olimpíadas"
    ],
    descricaoItem: "SERVIÇO DE ARBITRAGEM ESPORTIVA, COM EQUIPE COMPLETA DE ÁRBITROS CERTIFICADOS, INCLUINDO ANOTADORES E MATERIAIS DE APOIO",
    categoria: "Recurso Humano",
    unidade: "diária"
  },

  // ── TRANSPORTE ──────────────────────────────────────────────────────────────
  {
    codigoItem: 20062,
    nome: "LOCAÇÃO DE ÔNIBUS",
    nomesAlternativos: [
      "ônibus", "onibus", "van", "ônibus/van", "transporte atletas",
      "fretamento", "ônibus fretado", "locação ônibus", "gerenciamento de transporte",
      "transporte escolar"
    ],
    descricaoItem: "LOCAÇÃO DE VEÍCULO TIPO ÔNIBUS/VAN COM MOTORISTA PARA TRANSPORTE DE ATLETAS E EQUIPE, INCLUSO SEGURO E COMBUSTÍVEL",
    categoria: "Transporte",
    unidade: "diária"
  },

  // ── RECURSOS HUMANOS — COORDENAÇÃO ─────────────────────────────────────────
  {
    codigoItem: 17612,
    nome: "COORDENADOR DE EVENTO",
    nomesAlternativos: [
      "coordenador", "coordenador geral", "coordenador acadêmico",
      "coordenador geral da modalidade", "coordenadores fedeesp",
      "coordenadores fedeesp - interceus", "coordenadores fedeesp - olimpíadas"
    ],
    descricaoItem: "SERVIÇO DE COORDENAÇÃO DE EVENTOS ESPORTIVOS, COM PROFISSIONAL RESPONSÁVEL PELA ORGANIZAÇÃO E GESTÃO DO EVENTO",
    categoria: "Recurso Humano",
    unidade: "diária"
  },
  {
    codigoItem: 17620,
    nome: "PROFESSOR / TÉCNICO ESPORTIVO",
    nomesAlternativos: [
      "professor", "professor de educação física", "técnico esportivo",
      "instrutor esportivo", "monitor", "equipe de monitoria", "monitoria"
    ],
    descricaoItem: "SERVIÇO DE DOCÊNCIA/MONITORIA ESPORTIVA, COM PROFISSIONAL HABILITADO EM EDUCAÇÃO FÍSICA OU ÁREA AFIM",
    categoria: "Recurso Humano",
    unidade: "diária"
  },
  {
    codigoItem: 17639,
    nome: "REPRESENTANTE / SECRETARIA",
    nomesAlternativos: [
      "representante", "representantes - coletivas", "secretaria",
      "secretaria e atendentes", "atendente", "recepcionista"
    ],
    descricaoItem: "SERVIÇO DE REPRESENTAÇÃO E SECRETARIADO EM EVENTOS, INCLUINDO CONTROLE DE INSCRIÇÕES E ATENDIMENTO AO PÚBLICO",
    categoria: "Recurso Humano",
    unidade: "diária"
  },
  {
    codigoItem: 17647,
    nome: "SOCORRISTA / PARAMÉDICO",
    nomesAlternativos: [
      "socorrista", "socorristas", "paramédico", "primeiros socorros",
      "ambulância", "ambulância básica", "ambulância uti", "uti móvel"
    ],
    descricaoItem: "SERVIÇO DE SUPORTE MÉDICO DE EMERGÊNCIA EM EVENTOS ESPORTIVOS, COM EQUIPE E VEÍCULO EQUIPADO",
    categoria: "Outro",
    unidade: "evento"
  },
  {
    codigoItem: 17655,
    nome: "PROFISSIONAL DE SEGURANÇA",
    nomesAlternativos: [
      "segurança", "profissional de segurança", "vigilante", "segurança patrimonial"
    ],
    descricaoItem: "SERVIÇO DE SEGURANÇA PATRIMONIAL E PESSOAL EM EVENTOS ESPORTIVOS",
    categoria: "Recurso Humano",
    unidade: "diária"
  },
  {
    codigoItem: 17663,
    nome: "PROFISSIONAL DE LIMPEZA",
    nomesAlternativos: [
      "limpeza", "profissional de limpeza", "auxiliar de limpeza", "zeladoria"
    ],
    descricaoItem: "SERVIÇO DE LIMPEZA E CONSERVAÇÃO DE INSTALAÇÕES DURANTE EVENTOS ESPORTIVOS",
    categoria: "Recurso Humano",
    unidade: "diária"
  },
  {
    codigoItem: 17671,
    nome: "LOCUTOR / MESTRE DE CERIMÔNIAS",
    nomesAlternativos: [
      "locução", "locutor", "mestre de cerimônias", "mc", "apresentador",
      "intérprete do mascote", "interprete mascote", "mascote"
    ],
    descricaoItem: "SERVIÇO DE LOCUÇÃO E APRESENTAÇÃO DE EVENTOS ESPORTIVOS, INCLUINDO ANIMAÇÃO E CONDUÇÃO DA CERIMÔNIA",
    categoria: "Recurso Humano",
    unidade: "evento"
  },

  // ── COMUNICAÇÃO E MÍDIA ────────────────────────────────────────────────────
  {
    codigoItem: 22586,
    nome: "FOTOGRAFIA E FILMAGEM",
    nomesAlternativos: [
      "fotografia", "filmagem", "cobertura foto e filmagem",
      "cobertura fotográfica", "cobertura jornalística", "registro fotográfico",
      "vídeo institucional", "video institucional", "foto giratória 360",
      "foto 360", "transmissão ao vivo", "transmissao ao vivo", "live"
    ],
    descricaoItem: "SERVIÇO DE FOTOGRAFIA, FILMAGEM E TRANSMISSÃO DE EVENTOS ESPORTIVOS, COM EDIÇÃO E ENTREGA EM MÍDIA DIGITAL",
    categoria: "Outro",
    unidade: "evento"
  },

  // ── INFRAESTRUTURA DE EVENTO ───────────────────────────────────────────────
  {
    codigoItem: 22594,
    nome: "MONTAGEM E DESMONTAGEM",
    nomesAlternativos: [
      "montagem", "montagem e desmontagem", "montagem e desmontagem de eventos",
      "infraestrutura evento", "logística evento"
    ],
    descricaoItem: "SERVIÇO DE MONTAGEM E DESMONTAGEM DE ESTRUTURAS PARA EVENTOS ESPORTIVOS, INCLUINDO PALCO, ARQUIBANCADA E DEMAIS EQUIPAMENTOS",
    categoria: "Outro",
    unidade: "evento"
  },
  {
    codigoItem: 22608,
    nome: "SISTEMA DE SOM E AUDIOVISUAL",
    nomesAlternativos: [
      "equipamento de som", "som", "sonorização", "audiovisual",
      "recurso áudio-visual", "recurso audiovisual", "projetor", "telão",
      "painel de led", "painel led"
    ],
    descricaoItem: "LOCAÇÃO E OPERAÇÃO DE SISTEMA DE SONORIZAÇÃO, AUDIOVISUAL E ILUMINAÇÃO PARA EVENTOS ESPORTIVOS",
    categoria: "Material não Esportivo",
    unidade: "evento"
  },

  // ── TECNOLOGIA E SISTEMAS ──────────────────────────────────────────────────
  {
    codigoItem: 22616,
    nome: "SISTEMA DE INSCRIÇÕES ONLINE",
    nomesAlternativos: [
      "sistema de inscrições", "sistema de inscrições on-line",
      "plataforma inscrição", "inscrição online", "website", "site"
    ],
    descricaoItem: "DESENVOLVIMENTO E OPERAÇÃO DE SISTEMA/PLATAFORMA ONLINE PARA GESTÃO DE INSCRIÇÕES E RESULTADOS DE EVENTOS ESPORTIVOS",
    categoria: "Outro",
    unidade: "evento"
  },
];

// Seed completo = materiais + serviços
const CATMAT_SPORTS_SEED_ALL: SeedItem[] = [
  ...CATMAT_SPORTS_SEED,
  ...CATSER_SEED,
];

// 1. Pesquisa local case-insensitive por palavra-chave no Banco Semente
// Verifica: nome principal + nomesAlternativos + descricaoItem
export function buscarMateriaisLocal(termo: string): GovernmentMaterial[] {
  if (!termo || termo.trim().length === 0) return [];

  const norm = (s: string) =>
    s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[-_]/g, " ");

  const queryClean = norm(termo);
  const palavras = queryClean.split(/\s+/).filter(p => p.length >= 3);

  const score = (m: SeedItem): number => {
    const campos = [
      m.nome,
      ...(m.nomesAlternativos || []),
      m.descricaoItem
    ].map(norm);

    if (campos.some(c => c.includes(queryClean))) return 2;

    const textoCombinado = campos.join(' ');
    if (palavras.length > 0 && palavras.every(p => textoCombinado.includes(p))) return 1;

    return 0;
  };

  return CATMAT_SPORTS_SEED_ALL
    .map(m => ({ m, s: score(m) }))
    .filter(({ s }) => s > 0)
    .sort((a, b) => b.s - a.s)
    .map(({ m }) => m);
}

/**
 * Retorna todos os itens do seed — materiais e serviços.
 */
export function listarTodosSeedLocal(): GovernmentMaterial[] {
  return [...CATMAT_SPORTS_SEED_ALL];
}

/**
 * Retorna true se o item é de Recurso Humano / serviço pessoal.
 * Esses itens NÃO têm cotações em Compras.gov.br pois são contratados
 * diretamente, não por licitação de material/serviço padronizado.
 * A coluna Mercado Gov deve exibir "N/A — Serv. Pessoal" em vez de traço.
 */
export function isRecursoHumano(item: { categoria?: string; nome?: string }): boolean {
  const cat = (item.categoria || '').toLowerCase();
  const nome = (item.nome || '').toLowerCase();
  if (cat.includes('recurso humano')) return true;
  const rhKeywords = ['professor', 'coordenador', 'árbitro', 'arbitro', 'anotador',
    'socorrista', 'segurança', 'limpeza', 'locução', 'locutor', 'mascote',
    'monitor', 'representante', 'secretaria', 'atendente'];
  return rhKeywords.some(k => nome.includes(k));
}

/**
 * Valida um código CATMAT/CATSER consultando a API oficial do
 * Compras.gov.br. Retorna a descrição oficial do código pra confirmação
 * do usuário, ou null se o código não existir no catálogo.
 */
export interface CatmatValidacao {
  valido: boolean;
  codigo?: number;
  tipo?: 'material' | 'servico';
  nome?: string;
  descricao?: string;
  grupo?: string;
  classe?: string;
  pdm?: string;
  ncm?: string;
  status?: string;
  sustentavel?: boolean;
  motivo?: string;
}

/**
 * Busca a lista de arquivos (edital, anexos) de uma contratacao no PNCP
 * a partir do numeroControlePNCP. Usado pra enriquecer cotacoes com link
 * direto pro PDF do edital antes de salvar a cesta na homologacao.
 *
 * Retorna null se nao houver dados (PNCP fora do ar, numero invalido, etc.)
 */
export interface ArquivoPNCP {
  tipo: string;
  titulo: string;
  url: string;
  dataPublicacao?: string;
  sequencial?: number;
}
export interface ArquivosContratacaoResposta {
  numeroControlePNCP: string;
  totalArquivos: number;
  arquivos: ArquivoPNCP[];
  linkEditalPdf: string;
  linkPaginaPncp: string;
}

export async function obterArquivosContratacao(numeroControlePNCP: string): Promise<ArquivosContratacaoResposta | null> {
  if (!numeroControlePNCP) return null;
  const projectId = storage.app.options.projectId;
  const url = `https://us-central1-${projectId}.cloudfunctions.net/obterArquivosContratacao?numeroControlePNCP=${encodeURIComponent(numeroControlePNCP)}`;
  try {
    const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!resp.ok) return null;
    return await resp.json();
  } catch (e) {
    console.warn('Falha ao obter arquivos PNCP:', e);
    return null;
  }
}

export async function validarCatmatOficial(
  codigo: number,
  tipo: 'material' | 'servico' = 'material'
): Promise<CatmatValidacao> {
  const projectId = storage.app.options.projectId;
  const url = `https://us-central1-${projectId}.cloudfunctions.net/validarCatmat?codigo=${encodeURIComponent(codigo)}&tipo=${tipo}`;
  try {
    const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!resp.ok && resp.status !== 404) {
      return { valido: false, motivo: `HTTP ${resp.status} ao consultar API oficial.` };
    }
    return await resp.json();
  } catch (e: any) {
    return { valido: false, motivo: e?.message || 'Falha de rede.' };
  }
}

// Obter especificações de um material pelo código CATMAT/CATSER
export function obterDetalheMaterialPorCodigo(codigo: number, termoFallback?: string): GovernmentMaterial | null {
  const material = CATMAT_SPORTS_SEED_ALL.find(m => m.codigoItem === codigo);
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
        municipio: r.municipio || '',
        modalidade: r.modalidade || '',
        situacao: r.situacao || '',
        criterioJulgamento: r.criterioJulgamento || '',
        modoDisputa: r.modoDisputa || '',
        amparoLegal: r.amparoLegal || '',
        leiAplicada: r.leiAplicada || '',
        objetoCompra: r.objetoCompra || '',
        codigoCatalogoItem: r.codigoCatalogoItem || '',
        descricaoItem: r.descricaoItem || '',
        fornecedorNome: r.fornecedorNome || '',
        fornecedorCnpj: r.fornecedorCnpj || '',
        inscricaoEstadualFornecedor: r.inscricaoEstadualFornecedor || '',
        identificadorCompra: r.identificadorCompra || r.numeroControlePNCP || '',
        numeroControlePNCP: r.numeroControlePNCP || '',
        dataHomologacao: r.dataHomologacao || '',
        dataVigenciaFinalAta: r.dataVigenciaFinalAta || '',
        dataPublicacao: r.dataPublicacao || '',
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
