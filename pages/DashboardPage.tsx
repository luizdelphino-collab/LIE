import { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { Link } from 'react-router-dom';
import { Briefcase, TrendingUp, DollarSign, Users } from 'lucide-react';
import { db } from '../lib/firebase';
import type { Projeto, StatusProjeto } from '../types';

interface Stats {
  totalProjetos: number;
  emExecucao: number;
  valorAprovado: number;
  valorCaptado: number;
  valorExecutado: number;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [projetosRecentes, setProjetosRecentes] = useState<Projeto[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'projects'));
        const projetos = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Projeto, 'id'>) }));

        const s: Stats = {
          totalProjetos: projetos.length,
          emExecucao: projetos.filter((p) => p.status === 'em_execucao').length,
          valorAprovado: projetos.reduce((acc, p) => acc + (p.valorAprovado || 0), 0),
          valorCaptado: projetos.reduce((acc, p) => acc + (p.valorCaptado || 0), 0),
          valorExecutado: projetos.reduce((acc, p) => acc + (p.valorExecutado || 0), 0),
        };
        setStats(s);
        setProjetosRecentes(projetos.slice(0, 5));
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
          icon={<Briefcase className="w-5 h-5" />}
          label="Projetos"
          value={String(stats?.totalProjetos ?? 0)}
          accent="bg-lie-green/10 text-lie-green"
        />
        <StatCard
          icon={<TrendingUp className="w-5 h-5" />}
          label="Em execução"
          value={String(stats?.emExecucao ?? 0)}
          accent="bg-blue-100 text-blue-700"
        />
        <StatCard
          icon={<DollarSign className="w-5 h-5" />}
          label="Valor captado"
          value={fmt(stats?.valorCaptado ?? 0)}
          accent="bg-amber-100 text-amber-700"
        />
        <StatCard
          icon={<Users className="w-5 h-5" />}
          label="Valor executado"
          value={fmt(stats?.valorExecutado ?? 0)}
          accent="bg-purple-100 text-purple-700"
        />
      </div>

      <section className="bg-white rounded-xl shadow-premium p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-lie-ink">Projetos recentes</h2>
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
            {projetosRecentes.map((p) => (
              <li key={p.id} className="py-3 flex items-center justify-between">
                <div>
                  <Link
                    to={`/projetos/${p.id}`}
                    className="font-medium text-lie-ink hover:text-lie-green"
                  >
                    {p.titulo || p.nome || 'Projeto Sem Título'}
                  </Link>
                  <div className="text-xs text-lie-gray">
                    {p.esfera} · exercício {p.exercicio} · {statusLabel(p.status)}
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
