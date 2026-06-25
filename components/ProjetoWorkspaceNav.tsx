/**
 * components/ProjetoWorkspaceNav.tsx
 *
 * Navegação do "workspace do projeto" — Fase 1 do replanejamento (2026-06).
 * Transforma as telas soltas do projeto (Plano · Itens · Cronograma · Documentos)
 * em seções de um lugar só: uma barra consistente, com a seção atual destacada,
 * em vez de botões avulsos espalhados em cada página.
 *
 * Ver docs/REPLANEJAMENTO-2026-06.md (§7, Fase 1).
 */

import { useNavigate } from 'react-router-dom';
import { LayoutDashboard, FileText, Package, Calendar, FolderOpen, ArrowLeft } from 'lucide-react';

type Secao = 'visao' | 'plano' | 'itens' | 'cronograma' | 'documentos';

interface Props {
  projetoId: string;
  active: Secao;
  /** Status do projeto (opcional) — exibe um selo à direita. */
  status?: string;
}

const SECOES: { id: Secao; label: string; icon: typeof FileText; rota: (id: string) => string }[] = [
  { id: 'visao', label: 'Visão Geral', icon: LayoutDashboard, rota: id => `/projetos/${id}` },
  { id: 'plano', label: 'Plano de Trabalho', icon: FileText, rota: id => `/projetos/${id}/plano` },
  { id: 'itens', label: 'Itens, Orçamento & Cronograma', icon: Package, rota: id => `/projetos/${id}/itens` },
  { id: 'documentos', label: 'Documentos', icon: FolderOpen, rota: id => `/projetos/${id}/documentos` },
];

const STATUS_INFO: Record<string, { label: string; cls: string }> = {
  em_elaboracao: { label: 'Em Elaboração', cls: 'bg-amber-100 text-amber-800 border-amber-200' },
  em_captacao: { label: 'Em Captação', cls: 'bg-blue-100 text-blue-800 border-blue-200' },
  em_analise: { label: 'Em Análise', cls: 'bg-indigo-100 text-indigo-800 border-indigo-200' },
  aprovado: { label: 'Aprovado', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  em_execucao: { label: 'Em Execução', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  em_prestacao_contas: { label: 'Prestação de Contas', cls: 'bg-purple-100 text-purple-800 border-purple-200' },
  concluido: { label: 'Concluído', cls: 'bg-gray-100 text-gray-700 border-gray-200' },
  diligencias: { label: 'Em Diligências', cls: 'bg-orange-100 text-orange-800 border-orange-200' },
  reprovado: { label: 'Reprovado', cls: 'bg-red-100 text-red-800 border-red-200' },
  cancelado: { label: 'Cancelado', cls: 'bg-red-100 text-red-700 border-red-200' },
  arquivado: { label: 'Arquivado', cls: 'bg-gray-100 text-gray-500 border-gray-200' },
};

export default function ProjetoWorkspaceNav({ projetoId, active, status }: Props) {
  const navigate = useNavigate();
  const info = status ? STATUS_INFO[status] : undefined;

  return (
    <div className="mb-6 -mt-1">
      {/* Linha 1: voltar + status */}
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={() => navigate('/projetos')}
          className="flex items-center gap-1.5 text-xs font-semibold text-lie-gray hover:text-lie-ink transition"
        >
          <ArrowLeft className="w-4 h-4" />
          Projetos
        </button>
        {info && (
          <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${info.cls}`}>
            {info.label}
          </span>
        )}
      </div>

      {/* Linha 2: abas das seções */}
      <nav className="flex items-center gap-1 border-b border-gray-200">
        {SECOES.map(s => {
          const Icon = s.icon;
          const ativo = s.id === active;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => { if (!ativo) navigate(s.rota(projetoId)); }}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-semibold border-b-2 -mb-px transition ${
                ativo
                  ? 'border-lie-green text-lie-green'
                  : 'border-transparent text-gray-500 hover:text-lie-ink hover:border-gray-300'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="whitespace-nowrap">{s.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
