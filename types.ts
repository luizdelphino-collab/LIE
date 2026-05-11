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
  | 'cancelado';          // cancelado

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
  // Identificação
  nome: string;
  numeroProcesso?: string;     // nº do processo no órgão (PRONAS, Estadual, etc.)
  esfera: EsferaIncentivo;     // federal/estadual/municipal
  orgao?: string;              // ex: "Ministério do Esporte" / "SELT-SP"
  modalidades: string[];       // ex: ["Voleibol", "Basquete"]
  manifestacao?: 'desporto_educacional' | 'rendimento' | 'participacao';

  // Proponente
  proponente: {
    razaoSocial: string;
    cnpj: string;
    responsavel: string;
    email: string;
    telefone?: string;
  };

  // Valores
  valorAprovado: number;       // R$ aprovado pelo órgão
  valorCaptado: number;        // R$ captado até o momento (denormalizado)
  valorExecutado: number;      // R$ executado até o momento (denormalizado)

  // Datas-chave
  exercicio: number;           // ano de exercício (ex: 2026)
  dataAprovacao?: Timestamp;
  dataInicioExecucao?: Timestamp;
  dataFimExecucao?: Timestamp;
  prazoCaptacao?: Timestamp;
  prazoPrestacaoContas?: Timestamp;

  // Local de execução
  cidade?: string;
  uf?: string;

  // Estado atual
  status: StatusProjeto;
  observacoes?: string;

  // Equipe
  coordenadorId?: string;      // UID do coordenador responsável
  equipeIds?: string[];        // UIDs com acesso ao projeto

  // Patrocinadores resumo (lista detalhada em subcoleção funding)
  patrocinadoresResumo?: Patrocinador[];

  // Metadados
  criadoEm: Timestamp;
  criadoPor: string;
  atualizadoEm?: Timestamp;
  atualizadoPor?: string;
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

export type TipoDocumento =
  | 'plano_trabalho'
  | 'parecer_aprovacao'
  | 'oficio'
  | 'contrato'
  | 'termo'
  | 'relatorio'
  | 'comprovante'
  | 'outro';

export interface DocumentoProjeto {
  id: string;
  projectId: string;
  tipo: TipoDocumento;
  titulo: string;
  descricao?: string;
  arquivoUrl: string;            // Storage path
  arquivoNome: string;
  arquivoTamanho?: number;
  dataDocumento?: Timestamp;
  criadoEm: Timestamp;
  criadoPor: string;
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
