/**
 * pages/ProjetoOverviewPage.tsx
 *
 * Visão Geral do projeto — o "painel de comando" da workspace de elaboração
 * (Fase 1 do replanejamento, 2026-06). Em vez de abrir o projeto direto num
 * formulário de 1.000 linhas, o usuário vê o projeto inteiro num relance:
 * o que está pronto, o que falta, valores, itens e pesquisa de preço — com
 * cada etapa clicável. É o "onde estou" que faltava.
 *
 * Ver docs/REPLANEJAMENTO-2026-06.md (§7, Fase 1).
 */

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, getDoc, collection, getDocs } from 'firebase/firestore';
import {
  FileText, Package, Calendar, FolderOpen, Scale, CheckCircle2, Circle,
  AlertTriangle, Loader2, Pencil, Building2, ChevronRight,
} from 'lucide-react';
import { db } from '../lib/firebase';
import type { Projeto, ItemProjeto } from '../types';
import ProjetoWorkspaceNav from '../components/ProjetoWorkspaceNav';

const FMT_BRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function fmtMes(m?: string): string {
  if (!m) return '—';
  const [ano, mes] = m.split('-');
  return mes && ano ? `${mes}/${ano}` : m;
}

interface ResumoSecao {
  estado: 'completo' | 'parcial' | 'vazio';
  detalhe: string;
}

// Classes estáticas (Tailwind CDN não gera classes montadas por interpolação).
const COR: Record<string, { bg: string; text: string }> = {
  sky: { bg: 'bg-sky-50', text: 'text-sky-600' },
  amber: { bg: 'bg-amber-50', text: 'text-amber-600' },
  emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600' },
  violet: { bg: 'bg-violet-50', text: 'text-violet-600' },
  blue: { bg: 'bg-blue-50', text: 'text-blue-600' },
};

export default function ProjetoOverviewPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [projeto, setProjeto] = useState<Projeto | null>(null);
  const [entidadeNome, setEntidadeNome] = useState<string>('');
  const [itens, setItens] = useState<ItemProjeto[]>([]);
  const [cronoCount, setCronoCount] = useState(0);
  const [docsCount, setDocsCount] = useState(0);

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      try {
        const projSnap = await getDoc(doc(db, 'projects', id));
        if (!projSnap.exists()) { setProjeto(null); return; }
        const proj = { id: projSnap.id, ...projSnap.data() } as Projeto;
        setProjeto(proj);

        const [itemsSnap, cronoSnap, docsSnap] = await Promise.all([
          getDocs(collection(db, 'projects', id, 'items')),
          getDocs(collection(db, 'projects', id, 'cronograma')),
          getDocs(collection(db, 'projects', id, 'documentos')),
        ]);
        setItens(itemsSnap.docs.map(d => ({ id: d.id, ...d.data() } as ItemProjeto)));
        setCronoCount(cronoSnap.size);
        setDocsCount(docsSnap.size);

        if (proj.entidadeId) {
          const entSnap = await getDoc(doc(db, 'entities', proj.entidadeId));
          if (entSnap.exists()) setEntidadeNome((entSnap.data() as any).nome || '');
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  if (loading) {
    return (
      <div className="p-6 flex items-center gap-2 text-lie-gray">
        <Loader2 className="w-5 h-5 animate-spin" /> Carregando projeto…
      </div>
    );
  }
  if (!projeto) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <p className="text-lie-gray">Projeto não encontrado.</p>
        <button onClick={() => navigate('/projetos')} className="mt-3 text-lie-green font-semibold">← Voltar aos projetos</button>
      </div>
    );
  }

  // ----- Cálculos de completude -----
  const totalOrcado = itens.reduce((s, it) => s + (it.valorTotal || 0), 0);
  const pesquisados = itens.filter(it => it.pesquisado || it.semCorrespondenciaCatalogo).length;
  const pesquisaPendente = itens.length - pesquisados;

  const planoCampos = [
    !!projeto.titulo,
    !!projeto.resumo,
    !!projeto.objetivoGeral,
    !!projeto.justificativa,
    !!projeto.metodologia,
    !!(projeto.mesInicio && projeto.mesTermino),
    !!(projeto.objetivosEspecificos?.length),
    !!((projeto.metasQuantitativas?.length || 0) + (projeto.metasQualitativas?.length || 0)),
  ];
  const planoOk = planoCampos.filter(Boolean).length;
  const planoPct = Math.round((planoOk / planoCampos.length) * 100);

  const secoes: { key: string; titulo: string; icon: typeof FileText; rota: string; cor: string; resumo: ResumoSecao }[] = [
    {
      key: 'plano', titulo: 'Plano de Trabalho', icon: FileText, rota: `/projetos/${id}/plano`, cor: 'sky',
      resumo: {
        estado: planoPct >= 90 ? 'completo' : planoPct >= 30 ? 'parcial' : 'vazio',
        detalhe: `${planoPct}% preenchido`,
      },
    },
    {
      key: 'itens', titulo: 'Itens & Orçamento', icon: Package, rota: `/projetos/${id}/itens`, cor: 'amber',
      resumo: {
        estado: itens.length > 0 ? 'completo' : 'vazio',
        detalhe: itens.length > 0 ? `${itens.length} ${itens.length === 1 ? 'item' : 'itens'} · ${FMT_BRL(totalOrcado)}` : 'Nenhum item ainda',
      },
    },
    {
      key: 'pesquisa', titulo: 'Pesquisa de Preço', icon: Scale, rota: `/projetos/${id}/itens`, cor: 'emerald',
      resumo: {
        estado: itens.length === 0 ? 'vazio' : pesquisaPendente === 0 ? 'completo' : 'parcial',
        detalhe: itens.length === 0 ? 'Depende dos itens' : `${pesquisados}/${itens.length} pesquisados`,
      },
    },
    {
      key: 'cronograma', titulo: 'Cronograma', icon: Calendar, rota: `/projetos/${id}/cronograma`, cor: 'violet',
      resumo: {
        estado: cronoCount > 0 ? 'completo' : 'vazio',
        detalhe: cronoCount > 0 ? 'Preenchido' : 'Pendente',
      },
    },
    {
      key: 'documentos', titulo: 'Documentos', icon: FolderOpen, rota: `/projetos/${id}/documentos`, cor: 'blue',
      resumo: {
        estado: docsCount > 0 ? 'completo' : 'vazio',
        detalhe: docsCount > 0 ? `${docsCount} ${docsCount === 1 ? 'documento' : 'documentos'}` : 'Nenhum documento',
      },
    },
  ];

  const concluidas = secoes.filter(s => s.resumo.estado === 'completo').length;
  const progressoPct = Math.round((concluidas / secoes.length) * 100);

  // ----- "O que falta" -----
  const pendencias: string[] = [];
  if (planoPct < 90) pendencias.push('Complete o plano de trabalho.');
  if (itens.length === 0) pendencias.push('Adicione itens ao orçamento.');
  if (itens.length > 0 && pesquisaPendente > 0) pendencias.push(`Pesquise o preço de ${pesquisaPendente} ${pesquisaPendente === 1 ? 'item' : 'itens'}.`);
  if (cronoCount === 0) pendencias.push('Monte o cronograma físico-financeiro.');
  if (docsCount === 0) pendencias.push('Anexe os documentos do projeto.');

  const corEstado = (e: ResumoSecao['estado']) =>
    e === 'completo' ? 'text-emerald-600' : e === 'parcial' ? 'text-amber-500' : 'text-gray-300';

  return (
    <div className="p-6 max-w-5xl mx-auto pb-20">
      <ProjetoWorkspaceNav projetoId={id!} active="visao" status={projeto.status} />

      {/* Cabeçalho do projeto */}
      <div className="flex items-start gap-4 mb-6">
        {projeto.logoUrl ? (
          <img src={projeto.logoUrl} alt="" className="w-16 h-16 rounded-lg object-contain bg-white border shrink-0" />
        ) : (
          <div className="w-16 h-16 rounded-lg bg-gray-100 flex items-center justify-center text-gray-300 border border-dashed shrink-0">
            <Package className="w-7 h-7" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-lie-ink leading-tight">{projeto.titulo || 'Projeto sem título'}</h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-lie-gray mt-1">
            {entidadeNome && <span className="flex items-center gap-1"><Building2 className="w-3.5 h-3.5" /> {entidadeNome}</span>}
            {projeto.instrumentoOrigem && <span>· {projeto.instrumentoOrigem}</span>}
            {(projeto.mesInicio || projeto.mesTermino) && (
              <span>· {fmtMes(projeto.mesInicio)} a {fmtMes(projeto.mesTermino)}{projeto.duracaoMeses ? ` (${projeto.duracaoMeses} meses)` : ''}</span>
            )}
          </div>
        </div>
        <button
          onClick={() => navigate(`/projetos/${id}/plano`)}
          className="flex items-center gap-2 bg-lie-green hover:bg-lie-greenDark text-white rounded-lg px-4 py-2 font-semibold shadow-sm shrink-0"
        >
          <Pencil className="w-4 h-4" /> Editar Plano
        </button>
      </div>

      {/* Barra de progresso geral */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-bold text-lie-ink">Progresso da elaboração</span>
          <span className="text-sm font-bold text-lie-green">{concluidas} de {secoes.length} etapas · {progressoPct}%</span>
        </div>
        <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-lie-green rounded-full transition-all" style={{ width: `${progressoPct}%` }} />
        </div>
        <div className="flex items-center justify-between mt-3 text-sm">
          <span className="text-lie-gray">Orçamento montado</span>
          <span className="font-bold text-lie-ink font-mono">{FMT_BRL(totalOrcado)}</span>
        </div>
      </div>

      {/* Cards das seções */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
        {secoes.map(s => {
          const Icon = s.icon;
          return (
            <button
              key={s.key}
              onClick={() => navigate(s.rota)}
              className="group text-left bg-white rounded-xl border border-gray-200 p-4 hover:border-lie-green hover:shadow-md transition shadow-sm"
            >
              <div className="flex items-center justify-between mb-2">
                <div className={`w-9 h-9 rounded-lg ${COR[s.cor].bg} flex items-center justify-center`}>
                  <Icon className={`w-5 h-5 ${COR[s.cor].text}`} />
                </div>
                {s.resumo.estado === 'completo'
                  ? <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                  : s.resumo.estado === 'parcial'
                    ? <AlertTriangle className="w-5 h-5 text-amber-400" />
                    : <Circle className="w-5 h-5 text-gray-200" />}
              </div>
              <div className="font-bold text-lie-ink text-sm">{s.titulo}</div>
              <div className={`text-xs mt-0.5 font-medium ${corEstado(s.resumo.estado)}`}>{s.resumo.detalhe}</div>
              <div className="flex items-center gap-1 text-[11px] text-lie-gray mt-2 group-hover:text-lie-green transition">
                Abrir <ChevronRight className="w-3.5 h-3.5" />
              </div>
            </button>
          );
        })}
      </div>

      {/* O que falta */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
        <h2 className="text-sm font-bold text-lie-ink mb-3">O que falta para concluir</h2>
        {pendencias.length === 0 ? (
          <div className="flex items-center gap-2 text-emerald-700 text-sm font-semibold">
            <CheckCircle2 className="w-5 h-5" /> Tudo pronto — o projeto está completo para elaboração. 🎉
          </div>
        ) : (
          <ul className="space-y-1.5">
            {pendencias.map((p, i) => (
              <li key={i} className="flex items-center gap-2 text-sm text-gray-600">
                <Circle className="w-3.5 h-3.5 text-amber-400 shrink-0" /> {p}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
