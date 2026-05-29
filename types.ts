// =============================================================================
// LIE — Modelo de domínio
// Sistema de gestão de projetos da Lei de Incentivo ao Esporte
// =============================================================================

import type { Timestamp } from 'firebase/firestore';

// ---------- Usuários e perfis ----------

export type UserRole =
  | 'admin'         // Acesso total ao sistema
  | 'coordenador'   // Coordena execução do projeto (cria, edita, cronograma)
  | 'captador'      // Lança e acompanha captação/incentivadores
  | 'financeiro'    // Lança despesas, emite relatórios financeiros
  | 'beneficiado'   // Atleta/aluno beneficiário (acesso restrito ao próprio cadastro)
  | 'leitor';       // Apenas leitura (auditoria, parceiros)

export interface AppUser {
  uid: string;
  email: string;
  nome: string;
  role: UserRole;
  cpf?: string;
  telefone?: string;
  projectIds?: string[];  // projetos aos quais o usuário tem acesso (não-admin)
  ativo: boolean;
  criadoEm: Timestamp;
  atualizadoEm?: Timestamp;
}

// ---------- Projeto LIE ----------

export type StatusProjeto =
  | 'em_elaboracao'       // sendo redigido, ainda não submetido
  | 'em_analise'          // submetido ao Ministério/Secretaria, aguardando aprovação
  | 'aprovado'            // aprovado, aguardando captação
  | 'em_captacao'         // captando recursos junto a incentivadores
  | 'em_execucao'         // captado, executando
  | 'em_prestacao_contas' // executado, prestando contas
  | 'concluido'           // prestação aprovada
  | 'arquivado'           // arquivado/encerrado
  | 'cancelado'           // cancelado
  | 'reprovado'           // reprovado
  | 'diligencias';        // diligências

export type InstrumentoOrigem = 
  | 'LPIE' | 'LIE' | 'CONDECA' | 'Emenda Federal' | 'Emenda Estadual' | 'Emenda Municipal' 
  | 'Chamamento Público' | 'Licitação' | 'DL' | 'Contratação Direta';

export type AmbitoAplicacao = 'Nacional' | 'Estadual' | 'Municipal';

export interface LocalExecucao {
  uf: string;
  municipios: string[];
}

export interface AcaoCronograma {
  id: string;
  acao: string;
  descricao: string;
  mesInicio: string; // YYYY-MM
  mesTermino: string; // YYYY-MM
}

export interface MetaProjeto {
  id: string;
  meta: string;
  indicador: string;
  formula: string;
  verificacao: string;
}

export interface ModalidadeProjeto {
  nome: string;
  paralimpica: boolean;
}

export type EsferaIncentivo = 'federal' | 'estadual' | 'municipal';

export interface Patrocinador {
  id: string;
  razaoSocial: string;
  cnpj: string;
  responsavel?: string;
  email?: string;
  telefone?: string;
  valorAportado: number;
  dataAporte?: Timestamp;
}

export interface Projeto {
  id: string;
  entidadeId: string;
  titulo: string;
  instrumentoOrigem: InstrumentoOrigem | string;
  orgao: string;
  orgaoOutro?: string;
  logoUrl?: string;
  planoDivulgacao?: string;
  entidadeSigla?: string;

  // Plano de Trabalho
  resumo?: string;
  mesInicio?: string; // YYYY-MM
  mesTermino?: string; // YYYY-MM
  duracaoMeses?: number;
  ambitoAplicacao?: AmbitoAplicacao;
  locais?: LocalExecucao[];
  modalidades?: ModalidadeProjeto[];
  pracaEsportiva?: {
    nome?: string;
    endereco?: string;
  };
  objetivoGeral?: string;
  objetivosEspecificos?: string[];
  justificativa?: string;
  caracterizacaoSocioeconomica?: string;
  metodologia?: string;
  
  // Cronograma
  cronograma?: AcaoCronograma[];
  
  // Público e Metas
  publicoAlvo?: {
    direto: string;
    faixaEtaria: string;
    indireto: string;
  };
  metasQualitativas?: MetaProjeto[];
  metasQuantitativas?: MetaProjeto[];

  // Estado atual
  status: StatusProjeto;
  
  // Financeiro (Dashboard)
  valorAprovado?: number;
  valorCaptado?: number;
  valorExecutado?: number;
  esfera?: string;
  exercicio?: string;
  nome?: string; // Algumas telas usam nome em vez de titulo

  // Metadados
  criadoEm: Timestamp;
  atualizadoEm?: Timestamp;
}

// ---------- Cronograma físico-financeiro ----------

export type StatusEtapa = 'pendente' | 'em_andamento' | 'concluida' | 'atrasada';

export interface EtapaCronograma {
  id: string;
  projectId: string;
  ordem: number;
  meta: string;              // ex: "Meta 1 — Capacitação técnica"
  etapa: string;             // ex: "Etapa 1.1 — Contratação de instrutores"
  atividade?: string;        // detalhamento
  dataInicioPrevista: Timestamp;
  dataFimPrevista: Timestamp;
  dataInicioReal?: Timestamp;
  dataFimReal?: Timestamp;
  valorPrevisto: number;
  valorExecutado: number;
  unidadeMedida?: string;    // ex: "horas", "alunos", "eventos"
  quantidadePrevista?: number;
  quantidadeRealizada?: number;
  status: StatusEtapa;
  observacoes?: string;
}

// ---------- Captação (aportes) ----------

export type StatusCaptacao = 'previsto' | 'confirmado' | 'recebido' | 'cancelado';

export interface Aporte {
  id: string;
  projectId: string;
  incentivador: {
    razaoSocial: string;
    cnpj: string;
    responsavel?: string;
    email?: string;
    telefone?: string;
  };
  valor: number;
  data: Timestamp;            // data prevista/recebimento
  status: StatusCaptacao;
  numeroRecibo?: string;
  comprovanteUrl?: string;    // Storage path
  observacoes?: string;
  criadoEm: Timestamp;
  criadoPor: string;
}

// ---------- Despesas ----------

export type CategoriaDespesa =
  | 'pessoal'
  | 'material_consumo'
  | 'material_permanente'
  | 'servicos_terceiros'
  | 'locacao'
  | 'transporte'
  | 'alimentacao'
  | 'hospedagem'
  | 'divulgacao'
  | 'outros';

export type StatusDespesa = 'prevista' | 'aprovada' | 'paga' | 'rejeitada';

export interface Despesa {
  id: string;
  projectId: string;
  etapaId?: string;              // ligação ao cronograma
  categoria: CategoriaDespesa;
  descricao: string;
  fornecedor: {
    razaoSocial?: string;
    cnpj?: string;
  };
  valor: number;
  data: Timestamp;
  dataPagamento?: Timestamp;
  formaPagamento?: 'pix' | 'ted' | 'boleto' | 'cartao' | 'dinheiro' | 'outro';
  numeroNF?: string;
  comprovanteUrl?: string;       // Storage path
  status: StatusDespesa;
  observacoes?: string;
  criadoEm: Timestamp;
  criadoPor: string;
}

// ---------- Beneficiários ----------

export type TipoBeneficiario = 'atleta' | 'aluno' | 'tecnico' | 'comunidade' | 'outro';

export interface Beneficiario {
  id: string;
  projectId: string;
  tipo: TipoBeneficiario;
  nome: string;
  cpf?: string;
  dataNascimento?: Timestamp;
  genero?: 'masculino' | 'feminino' | 'outro' | 'nao_informar';
  cidade?: string;
  uf?: string;
  escola?: string;
  modalidade?: string;
  categoria?: string;            // ex: "Sub-15"
  responsavel?: {
    nome: string;
    cpf?: string;
    telefone?: string;
    parentesco?: string;
  };
  fotoUrl?: string;
  termoAutorizacaoUrl?: string;  // LGPD/uso de imagem
  ativo: boolean;
  criadoEm: Timestamp;
}

// ---------- Documentos do projeto ----------

export type TipoDocumentoProjeto =
  | 'Edital'
  | 'Termo de Referência'
  | 'Chamamento Público'
  | 'Portaria'
  | 'Declaração'
  | 'Orçamento'
  | 'Pesquisa de Preço'
  | 'Outro';

export interface DocumentoProjeto {
  id: string;
  projectId: string;
  nome: string;
  tipo: TipoDocumentoProjeto | string;
  dataAssinatura?: Timestamp;
  observacao?: string;
  arquivoUrl: string;
  ordem?: number;
  criadoEm: Timestamp;
}

// ---------- Itens (Banco de Dados de Itens) ----------

export type CategoriaItem =
  | 'Alimento'
  | 'Transporte'
  | 'Material Esportivo'
  | 'Material não Esportivo'
  | 'Recurso Humano'
  | 'Outro';

export type UnidadeMedida =
  | 'diária'
  | 'metro'
  | 'metro²'
  | 'unidade'
  | 'pacote'
  | 'caixa'
  | 'kit'
  | 'mês'
  | 'Kg';

export interface ItemMaster {
  id: string;
  codigo: number; // Gerado sequencialmente (interno)
  nome: string;
  descricao?: string;
  unidade: UnidadeMedida | string;
  valorUnitario: number;
  categoria: CategoriaItem | string;
  criadoEm: Timestamp;
  // CATMAT/CATSER oficial validado via API do Compras.gov.br.
  // Obrigatório pra que o item entre na pesquisa automática de preços.
  codigoCatmat?: number;
  tipoCatmat?: 'material' | 'servico';
  nomeCatmatOficial?: string;
  descricaoCatmatOficial?: string;
  // Conversão de embalagem pra unidade base — permite comparação justa
  // Ex: "caixa com 48 copos de 200ml" → fatorConversao=9600, unidadeBase='ML'
  // Sistema calcula preço base = valorUnitario / fatorConversao (R$/ml)
  fatorConversao?: number;
  unidadeBase?: string; // ML, G, L, UN, M, M², KG
  embalagemDescricao?: string; // texto livre p/ humano (ex: "Caixa com 48 copos de 200ml")
  // Item declaradamente sem correspondencia no CATMAT/CATSER. Pesquisa de preco
  // segue rota legal alternativa: cotacoes com fornecedores (IN SEGES/ME 73/2020
  // art. 5o IV ou IN 65/2021 art. 5o V — em linha com Lei 14.133/21 art. 28 e
  // Acordao TCU 1445/2015 sobre fontes diversificadas).
  semCorrespondenciaCatalogo?: boolean;

  // Pesquisa de preco publica (IN 65/2021) — agora vive no Banco (etapa 5C).
  // Quando o item e vinculado a um projeto, esses campos sao herdados via
  // sincronizacao automatica. Pesquisa e feita UMA VEZ no Banco, vale pra
  // todos os projetos que usam esse master.
  pesquisado?: boolean;
  referencias?: PrecoReferencia[];
  mediaReferencia?: number;
  medianaReferencia?: number;
  tokenPesquisa?: string;
  ultimoCodigoVinculado?: number;
  pesquisaAtualizadaEm?: Timestamp;
  // Snapshot pre-IA (preservado pra rollback do batch Padronizar Nomenclatura v1.12.x)
  nomeOriginalLIE?: string;
  descricaoOriginalLIE?: string;
  unidadeOriginalLIE?: string;
  // Snapshot pos-IA (preservado quando restauramos os originais — historico)
  nomePadronizadoIA?: string;
  descricaoPadronizadaIA?: string;
  unidadePadronizadaIA?: string;
  padronizadoEm?: Timestamp;
  padronizadoModelo?: string;
  vinculadoPorIA?: boolean;
  vinculadoEm?: Timestamp;
  // Sinal de que o item precisa passar pelo wizard de atributos (redesign 2026-05-29)
  precisaCompletarWizard?: boolean;
  restauradoEm?: Timestamp;
}

export interface PrecoReferencia {
  orgaoLicitante: string;
  uasg?: string;
  identificadorCompra: string;
  dataHomologacao: string;
  quantidade?: number;
  unidadeMedida?: string;
  valorUnitario: number;
  fonte:
    // Fontes governamentais automaticas (IN 73/2020 art. 5o I e II)
    | 'compras.gov.br' | 'pncp' | 'pncp-contratacao' | 'pncp-ata' | 'tce-pe'
    // Fontes manuais categorizadas (IN 73/2020 art. 5o II/III/IV/V)
    | 'contrato-publico'  // contratos publicos similares de outros entes (II)
    | 'convenio'          // convenios (II)
    | 'termo-fomento'     // termos de fomento ou colaboracao - tipico LIE (II)
    | 'tabela-preco'      // tabelas de precos / midia especializada (III)
    | 'fomento'           // legado, equivalente a termo-fomento
    | 'manual';           // ULTIMO RECURSO: 3 orcamentos de fornecedores (IV)
  // Identidade do órgão
  cnpjOrgao?: string;
  poder?: string;
  esfera?: string;
  uf?: string;
  // Legalidade
  modalidade?: string;
  situacao?: string;
  // Identidade do item
  codigoCatalogoItem?: string;
  descricaoItem?: string;
  // Adjudicatário
  fornecedorNome?: string;
  fornecedorCnpj?: string;
  // Identificadores
  numeroControlePNCP?: string;
  // Temporal
  dataVigenciaFinalAta?: string;
  // Preservação da URL original do PNCP (sobrescrita pelo arquivo Storage quando cai no fallback)
  linkPncpOriginal?: string;
  localizacaoUrl: string; // Para manual/fomento, é a URL de upload no Firebase Storage
  arquivoNome?: string;
  // Campos enriquecidos (etapa pos-5C) extraidos da Cloud Function:
  municipio?: string;
  criterioJulgamento?: string;
  modoDisputa?: string;
  amparoLegal?: string;
  leiAplicada?: string;
  objetoCompra?: string;
  inscricaoEstadualFornecedor?: string;
  dataPublicacao?: string;
  // PDF direto do edital (obtido via obterArquivosContratacao no momento da homologacao)
  linkEditalPdf?: string;
  // Lista de arquivos do PNCP (edital + anexos) — populada lazy quando enriquecemos
  arquivosPNCP?: Array<{ tipo: string; titulo: string; url: string; dataPublicacao?: string }>;
  // Embalagem do item homologado — separa quantidade (unidades) de capacidade (ML/L/G).
  // Antes: unidadeMedida estava confundindo os dois conceitos. Agora:
  // - quantidade + siglaUnidadeFornecimento = "1000 UN" (1000 unidades)
  // - capacidadeUnidadeFornecimento + siglaUnidadeMedida = "200 ML" (cada unidade = 200ml)
  // - nomeUnidadeFornecimento = "COPO" (forma humana da embalagem)
  siglaUnidadeFornecimento?: string;
  nomeUnidadeFornecimento?: string;
  capacidadeUnidadeFornecimento?: number;
  siglaUnidadeMedida?: string;
}

export interface ItemProjeto {
  id: string;
  projectId: string;
  itemId: string; // Referência ao ItemMaster
  nome: string; // Copiado para histórico
  descricao?: string;
  unidade: string;
  valorUnitario: number;
  memorialCalculo: string;
  quantidade: number;
  valorTotal: number;
  ordem?: number;
  fornecedoresIds?: string[]; // IDs dos fornecedores vinculados ao item na execução
  criadoEm: Timestamp;

  // CATMAT/CATSER oficial herdado do ItemMaster — usado pela pesquisa
  codigoCatmat?: number;
  tipoCatmat?: 'material' | 'servico';
  nomeCatmatOficial?: string;
  descricaoCatmatOficial?: string;
  // Conversão de embalagem (herdada do master)
  fatorConversao?: number;
  unidadeBase?: string;
  embalagemDescricao?: string;
  // Item sem correspondencia no CATMAT/CATSER (herdado do master): pesquisa
  // de preco segue rota legal de 3 orcamentos com fornecedores.
  semCorrespondenciaCatalogo?: boolean;

  // Campos de Pesquisa de Preço Público (IN 65/2021)
  pesquisado?: boolean;
  ultimoCodigoVinculado?: number;
  referencias?: PrecoReferencia[];
  mediaReferencia?: number;
  medianaReferencia?: number;
  tokenPesquisa?: string; // Token neutro único para validação pública
}

export interface CronogramaItem {
  id: string;
  projectId: string;
  itemProjetoId: string;
  mes: number;
  quantidade: number;
  valorTotal: number;
  criadoEm: Timestamp;
}

// ---------- Execução Mensal ----------

export type StatusExecucaoMes = 'pendente' | 'consolidado';

export interface ExecucaoMensalItemFornecedor {
  fornecedorId: string;
  quantidade: number;
  notaFiscalUrl?: string;
  comprovanteUrl?: string;
  extratoBancarioUrl?: string;
}

export interface ExecucaoMensalItem {
  itemProjetoId: string;
  fornecedoresExecucao: ExecucaoMensalItemFornecedor[];
}

export interface ExecucaoMensal {
  id: string;
  projectId: string;
  mes: number;
  status: StatusExecucaoMes;
  itens: ExecucaoMensalItem[];
  consolidadoEm?: Timestamp;
  atualizadoEm?: Timestamp;
}

// ---------- Relatórios ----------

export type TipoRelatorio = 'mensal' | 'trimestral' | 'semestral' | 'final' | 'parcial';
export type StatusRelatorio = 'em_elaboracao' | 'submetido' | 'aprovado' | 'reprovado';

export interface Relatorio {
  id: string;
  projectId: string;
  tipo: TipoRelatorio;
  periodoInicio: Timestamp;
  periodoFim: Timestamp;
  titulo: string;
  resumoExecutivo?: string;
  metasAtingidas?: string;
  dificuldades?: string;
  arquivoUrl?: string;           // PDF anexado/gerado
  status: StatusRelatorio;
  dataSubmissao?: Timestamp;
  dataAprovacao?: Timestamp;
  observacoesOrgao?: string;
  criadoEm: Timestamp;
  criadoPor: string;
}

// ---------- Logs de atividade ----------

export interface ActivityLog {
  id: string;
  acao: string;                  // ex: "projeto.criar", "despesa.atualizar"
  userId?: string;
  userEmail?: string;
  projectId?: string;
  metadata?: Record<string, unknown>;
  criadoEm: Timestamp;
}

// ---------- Entidades (Proponentes, Patrocinadores, etc) ----------

export type TipoEntidade = 'proponente' | 'patrocinador' | 'parceiro' | 'outro';

export interface Entidade {
  id: string;
  tipo: TipoEntidade;
  nome: string;
  sigla?: string;
  cnpj: string;
  logoUrl?: string;
  corPredominante?: string; // hex, ex: "#16A34A"

  // Endereço
  cep?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;

  // Contato
  telefones?: string[];
  email?: string;
  site?: string;
  instagram?: string;
  facebook?: string;
  tiktok?: string;
  youtube?: string;
  linkedin?: string;

  // Responsável Legal
  responsavelLegal?: {
    nome: string;
    cargo?: string;
    cpf?: string;
    email?: string;
    telefone?: string;
  };

  historico?: string;
  capacidadeTecnica?: string;

  criadoEm: Timestamp;
  atualizadoEm?: Timestamp;
}

export type TipoDocumentoEntidade = 
  | 'Ata' 
  | 'Estatuto' 
  | 'Contrato Social' 
  | 'Certidão' 
  | 'CNPJ' 
  | 'Comprovante de Endereço' 
  | 'Capacidade Técnica e Operacional' 
  | 'Portfólio' 
  | 'Outro';

export interface DocumentoEntidade {
  id: string;
  entidadeId: string;
  nome: string;
  tipo: TipoDocumentoEntidade | string;
  emissao?: Timestamp;
  validade?: Timestamp;
  observacao?: string;
  arquivoUrl: string;
  ordem?: number;
  criadoEm: Timestamp;
}

export type EscolaridadeDirigente = 
  | 'Ensino Fundamental Incompleto'
  | 'Ensino Fundamental Completo'
  | 'Ensino Médio Incompleto'
  | 'Ensino Médio Completo'
  | 'Ensino Superior Incompleto'
  | 'Ensino Superior Completo (Graduação)'
  | 'Pós-graduação Especialização / MBA'
  | 'Mestrado'
  | 'Doutorado / Pós-doutorado';

export interface Dirigente {
  id: string;
  entidadeId: string;
  nome: string;
  cargo?: string;
  escolaridade?: EscolaridadeDirigente | string;
  cpf?: string;
  telefone?: string;
  email?: string;
  
  // Endereço
  cep?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  cidade?: string;
  uf?: string;
  bairro?: string;
  ordem?: number;

  criadoEm: Timestamp;
  atualizadoEm?: Timestamp;
}

export type TipoDocumentoDirigente = 
  | 'Documento Pessoal'
  | 'Comprovante de Endereço'
  | 'Comprovante de Escolaridade'
  | 'Certidão'
  | 'Currículo'
  | 'Outros';

export interface DocumentoDirigente {
  id: string;
  dirigenteId: string;
  entidadeId: string; // denormalizado para facilitar
  nome: string;
  tipo: TipoDocumentoDirigente | string;
  emissao?: Timestamp;
  validade?: Timestamp;
  observacao?: string;
  arquivoUrl: string;
  criadoEm: Timestamp;
}

// ---------- Fornecedores ----------

export interface Fornecedor {
  id: string;
  razaoSocial: string;
  nomeFantasia: string;
  cnpj: string;
  atuacaoPrimaria: string;
  atuacoesSecundarias?: string[];
  logoUrl?: string;

  // Endereço
  cep?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;

  // Contato
  telefoneComercial?: string;
  celular?: string;
  email?: string;
  site?: string;
  instagram?: string;
  facebook?: string;
  outraRede?: string;
  
  observacoes?: string;
  criadoEm: Timestamp;
  atualizadoEm?: Timestamp;
}

export type TipoDocumentoFornecedor =
  | 'CNPJ'
  | 'Certidão'
  | 'Estatuto'
  | 'Contrato Social'
  | 'Ata'
  | 'Outro';

export interface DocumentoFornecedor {
  id: string;
  fornecedorId: string;
  nome: string;
  tipo: TipoDocumentoFornecedor | string;
  emissao?: Timestamp;
  validade?: Timestamp;
  observacao?: string;
  arquivoUrl: string;
  ordem?: number;
  criadoEm: Timestamp;
}
