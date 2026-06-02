import { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { Link } from 'react-router-dom';
import { Briefcase, TrendingUp, DollarSign, Users } from 'lucide-react';
import { db } from '../lib/firebase';
import type { Projeto, StatusProjeto } from '../types';

interface Stats {
  totalProjetos: number;
  totalEntidades: number;
  totalItens: number;
  totalFornecedores: number;
  projetosPorStatus: Record<string, { count: number; valor: number }>;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [projetosRecentes, setProjetosRecentes] = useState<Projeto[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [snapProjetos, snapEntidades, snapItens, snapFornecedores] = await Promise.all([
          getDocs(collection(db, 'projects')),
          getDocs(collection(db, 'entities')),
          getDocs(collection(db, 'items')),
          getDocs(collection(db, 'suppliers'))
        ]);

        const entidadesMap: Record<string, string> = {};
        snapEntidades.docs.forEach(d => {
          entidadesMap[d.id] = d.data().nome;
        });

        const projetos = snapProjetos.docs.map((d) => {
          const data = d.data() as Omit<Projeto, 'id'>;
          return {
            id: d.id,
            ...data,
            entidadeNome: entidadesMap[data.entidadeId] || 'Entidade desconhecida'
          };
        });

        const projetosPorStatus: Record<string, { count: number; valor: number }> = {};
        projetos.forEach(p => {
          const status = p.status || 'em_elaboracao';
          if (!projetosPorStatus[status]) {
            projetosPorStatus[status] = { count: 0, valor: 0 };
          }
          projetosPorStatus[status].count += 1;
          projetosPorStatus[status].valor += (p.valorAprovado || 0);
        });

        const s: Stats = {
          totalProjetos: projetos.length,
          totalEntidades: snapEntidades.size,
          totalItens: snapItens.size,
          totalFornecedores: snapFornecedores.size,
          projetosPorStatus
        };
        setStats(s);
        setProjetosRecentes(
          projetos
            .sort((a, b) => (b.criadoEm?.toMillis?.() ?? 0) - (a.criadoEm?.toMillis?.() ?? 0))
            .slice(0, 5)
        );
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const fmt = (v?: number) => {
    if (v === undefined || v === null) return 'R$ 0,00';
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };

  if (loading) {
    return <div className="p-8 text-lie-gray">Carregando…</div>;
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-lie-ink">Dashboard</h1>
        <p className="text-sm text-lie-gray">Visão geral dos projetos LIE</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          icon={<Users className="w-5 h-5" />}
          label="Entidades"
          value={String(stats?.totalEntidades ?? 0)}
          accent="bg-blue-100 text-blue-700"
        />
        <StatCard
          icon={<Briefcase className="w-5 h-5" />}
          label="Projetos"
          value={String(stats?.totalProjetos ?? 0)}
          accent="bg-lie-green/10 text-lie-green"
        />
        <StatCard
          icon={<DollarSign className="w-5 h-5" />}
          label="Itens Cadastrados"
          value={String(stats?.totalItens ?? 0)}
          accent="bg-amber-100 text-amber-700"
        />
        <StatCard
          icon={<TrendingUp className="w-5 h-5" />}
          label="Fornecedores"
          value={String(stats?.totalFornecedores ?? 0)}
          accent="bg-purple-100 text-purple-700"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
        {/* Projetos por Status */}
        <section className="bg-white rounded-xl shadow-premium p-6">
          <h2 className="text-lg font-semibold text-lie-ink mb-4">Projetos por Status</h2>
          {Object.keys(stats?.projetosPorStatus || {}).length === 0 ? (
            <p className="text-sm text-lie-gray">Nenhum projeto cadastrado.</p>
          ) : (
            <div className="space-y-4">
              {Object.entries(stats?.projetosPorStatus || {}).map(([status, data]) => (
                <div key={status} className="flex justify-between items-center bg-gray-50 p-3 rounded-lg border border-gray-100">
                  <div>
                    <div className="font-medium text-lie-ink">{statusLabel(status as StatusProjeto)}</div>
                    <div className="text-xs text-lie-gray">{data.count} {data.count === 1 ? 'projeto' : 'projetos'}</div>
                  </div>
                  <div className="text-sm font-semibold text-lie-ink">
                    {fmt(data.valor)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Projetos Recentes */}
        <section className="bg-white rounded-xl shadow-premium p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-lie-ink">Projetos Recentes</h2>
            <Link to="/projetos" className="text-sm text-lie-green hover:underline">
              Ver todos
            </Link>
          </div>

          {projetosRecentes.length === 0 ? (
            <p className="text-sm text-lie-gray py-8 text-center">
              Nenhum projeto cadastrado ainda.{' '}
              <Link to="/projetos/novo" className="text-lie-green hover:underline">
                Criar o primeiro
              </Link>
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {projetosRecentes.map((p: any) => (
                <li key={p.id} className="py-3 flex items-center justify-between">
                  <div>
                    <Link
                      to={`/projetos/${p.id}`}
                      className="font-medium text-lie-ink hover:text-lie-green"
                    >
                      {p.titulo || p.nome || 'Projeto Sem Título'}
                    </Link>
                    <div className="text-xs text-lie-gray mt-1">
                      <span className="font-semibold text-lie-ink">{p.entidadeNome}</span>
                      <span className="mx-2">•</span>
                      {statusLabel(p.status)}
                    </div>
                  </div>
                  <div className="text-sm font-semibold text-lie-ink">
                    {fmt(p.valorAprovado)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="bg-white rounded-xl shadow-premium p-5">
      <div className={`inline-flex items-center justify-center w-10 h-10 rounded-lg ${accent} mb-3`}>
        {icon}
      </div>
      <div className="text-2xl font-bold text-lie-ink">{value}</div>
      <div className="text-sm text-lie-gray">{label}</div>
    </div>
  );
}

function statusLabel(s: StatusProjeto): string {
  const map: Record<StatusProjeto, string> = {
    em_elaboracao: 'Em elaboração',
    em_analise: 'Em análise',
    aprovado: 'Aprovado',
    em_captacao: 'Em captação',
    em_execucao: 'Em execução',
    em_prestacao_contas: 'Prestação de contas',
    concluido: 'Concluído',
    arquivado: 'Arquivado',
    cancelado: 'Cancelado',
    reprovado: 'Reprovado',
    diligencias: 'Diligências',
  };
  return map[s];
}
