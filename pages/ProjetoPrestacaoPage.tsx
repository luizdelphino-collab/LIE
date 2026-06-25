/**
 * pages/ProjetoPrestacaoPage.tsx
 *
 * Prestação de Contas — consome a execução automaticamente. Periodicidade flexível
 * (parcial/final, por intervalo de meses, conforme cada órgão). Para cada prestação:
 *  - demonstrativo físico-financeiro (previsto × realizado) por Etapa › Item no período;
 *  - relação de documentos (NF · certidões · pagamento) das execuções do período;
 *  - remanejamento + saldo a devolver;
 *  - narrativa (cumprimento do objeto, metas, dificuldades) — mista (IA + manual, IA na próxima etapa).
 * (Replanejamento 2026-06.)
 */

import { useEffect, useMemo, useState, Fragment } from 'react';
import { useParams } from 'react-router-dom';
import {
  collection, query, getDocs, getDoc, doc, setDoc, deleteDoc, serverTimestamp, orderBy, Timestamp,
} from 'firebase/firestore';
import {
  Loader2, Plus, FileText, FileCheck2, Trash2, ChevronLeft, Send, Layers, Building2, CheckCircle2, Wand2, Printer, ChevronDown, ChevronUp,
} from 'lucide-react';
import { db } from '../lib/firebase';
import type { Projeto, ItemProjeto, CronogramaItem, Fornecedor, EtapaProjeto, Prestacao, StatusPrestacao } from '../types';
import ProjetoWorkspaceNav from '../components/ProjetoWorkspaceNav';
import AutoResizeTextarea from '../components/AutoResizeTextarea';
import { gerarPrestacaoContas } from '../lib/planoIaApi';
import { gerarPrestacaoPdf } from '../lib/gerarPrestacaoPdf';

const FMT = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const MESES_ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
function rotuloMes(n: number, mesInicio?: string): string {
  if (!mesInicio) return `Mês ${n}`;
  const [ay, am] = mesInicio.split('-').map(Number);
  if (!ay || !am) return `Mês ${n}`;
  const idx = (am - 1) + (n - 1);
  return `${MESES_ABREV[idx % 12]}/${String(ay + Math.floor(idx / 12)).slice(2)}`;
}
interface Execucao { id: string; itemProjetoId: string; mes: number; quantidade: number; fornecedorId: string; notaFiscalUrl: string; certidoesUrl: string; pagamentoUrl: string; }
const STATUS_INFO: Record<StatusPrestacao, { label: string; cls: string }> = {
  em_elaboracao: { label: 'Em elaboração', cls: 'bg-amber-100 text-amber-800 border-amber-200' },
  submetida: { label: 'Submetida', cls: 'bg-blue-100 text-blue-800 border-blue-200' },
  aprovada: { label: 'Aprovada', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  reprovada: { label: 'Reprovada', cls: 'bg-red-100 text-red-800 border-red-200' },
};

export default function ProjetoPrestacaoPage() {
  const { id } = useParams();
  const [loading, setLoading] = useState(true);
  const [projeto, setProjeto] = useState<Projeto | null>(null);
  const [itens, setItens] = useState<ItemProjeto[]>([]);
  const [etapas, setEtapas] = useState<EtapaProjeto[]>([]);
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [previsto, setPrevisto] = useState<Record<string, Record<number, number>>>({});
  const [execucoes, setExecucoes] = useState<Execucao[]>([]);
  const [prestacoes, setPrestacoes] = useState<Prestacao[]>([]);
  const [sel, setSel] = useState<Prestacao | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [gerandoIA, setGerandoIA] = useState(false);
  const [entidadeNome, setEntidadeNome] = useState('');
  const [expandido, setExpandido] = useState<Set<string>>(new Set());
  const [novoTipo, setNovoTipo] = useState<'parcial' | 'final'>('final');
  const [novoMesIni, setNovoMesIni] = useState(1);
  const [novoMesFim, setNovoMesFim] = useState(1);

  const duracao = projeto?.duracaoMeses || 12;
  const meses = useMemo(() => Array.from({ length: duracao }, (_, i) => i + 1), [duracao]);

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      try {
        const projSnap = await getDoc(doc(db, 'projects', id));
        let dur = 12;
        if (projSnap.exists()) {
          const p = { id: projSnap.id, ...projSnap.data() } as Projeto; setProjeto(p); setEtapas(p.etapas || []); dur = p.duracaoMeses || 12;
          if (p.entidadeId) { const ent = await getDoc(doc(db, 'entities', p.entidadeId)); if (ent.exists()) setEntidadeNome((ent.data() as any).nome || ''); }
        }
        setNovoMesFim(dur);
        const [itSnap, fSnap, cSnap, eSnap, pSnap] = await Promise.all([
          getDocs(query(collection(db, `projects/${id}/items`), orderBy('criadoEm', 'asc'))),
          getDocs(query(collection(db, 'suppliers'), orderBy('razaoSocial', 'asc'))),
          getDocs(collection(db, `projects/${id}/cronograma`)),
          getDocs(collection(db, `projects/${id}/execucoes`)),
          getDocs(collection(db, `projects/${id}/prestacoes`)),
        ]);
        setItens(itSnap.docs.map(d => ({ id: d.id, ...d.data() } as ItemProjeto)));
        setFornecedores(fSnap.docs.map(d => ({ id: d.id, ...d.data() } as Fornecedor)));
        const prev: Record<string, Record<number, number>> = {};
        cSnap.docs.forEach(d => { const ci = d.data() as CronogramaItem; (prev[ci.itemProjetoId] ||= {})[ci.mes] = ci.quantidade; });
        setPrevisto(prev);
        setExecucoes(eSnap.docs.map(d => ({ id: d.id, ...d.data() } as Execucao)));
        setPrestacoes(pSnap.docs.map(d => ({ id: d.id, ...d.data() } as Prestacao)));
      } finally { setLoading(false); }
    })();
  }, [id]);

  const valorUnitDe = (iid: string) => itens.find(i => i.id === iid)?.valorUnitario || 0;
  const fornecedorNome = (fid: string) => { const f = fornecedores.find(x => x.id === fid); return f ? (f.nomeFantasia || f.razaoSocial) : '—'; };

  const novaPrestacao = async () => {
    if (!id) return;
    if (novoMesFim < novoMesIni) { alert('Mês final não pode ser antes do inicial.'); return; }
    const r = doc(collection(db, `projects/${id}/prestacoes`));
    const titulo = novoTipo === 'final' ? 'Prestação de Contas Final' : `Prestação Parcial (${rotuloMes(novoMesIni, projeto?.mesInicio)}–${rotuloMes(novoMesFim, projeto?.mesInicio)})`;
    const nova: Prestacao = { id: r.id, projectId: id, tipo: novoTipo, titulo, mesInicio: novoMesIni, mesFim: novoMesFim, status: 'em_elaboracao', criadoEm: serverTimestamp() as Timestamp };
    await setDoc(r, nova as any);
    setPrestacoes(prev => [...prev, nova]);
    setSel(nova);
  };

  const removerPrestacao = async (p: Prestacao) => {
    if (!id || !window.confirm('Remover esta prestação de contas?')) return;
    await deleteDoc(doc(db, `projects/${id}/prestacoes`, p.id));
    setPrestacoes(prev => prev.filter(x => x.id !== p.id));
    if (sel?.id === p.id) setSel(null);
  };

  const salvarNarrativa = async () => {
    if (!id || !sel) return;
    setSalvando(true);
    try {
      await setDoc(doc(db, `projects/${id}/prestacoes`, sel.id), {
        resumoExecutivo: sel.resumoExecutivo || '', metasAtingidas: sel.metasAtingidas || '',
        dificuldades: sel.dificuldades || '', observacoes: sel.observacoes || '',
      }, { merge: true });
      setPrestacoes(prev => prev.map(x => x.id === sel.id ? sel : x));
      alert('Prestação salva.');
    } finally { setSalvando(false); }
  };

  const mudarStatus = async (st: StatusPrestacao) => {
    if (!id || !sel) return;
    const patch: any = { status: st };
    if (st === 'submetida') patch.dataSubmissao = serverTimestamp();
    await setDoc(doc(db, `projects/${id}/prestacoes`, sel.id), patch, { merge: true });
    const novo = { ...sel, status: st };
    setSel(novo); setPrestacoes(prev => prev.map(x => x.id === sel.id ? novo : x));
  };

  // ---- agregação do período ----
  const mesesDo = (p: Prestacao) => meses.filter(m => m >= p.mesInicio && m <= p.mesFim);
  const prevItem = (iid: string, p: Prestacao) => round2(mesesDo(p).reduce((s, m) => s + (previsto[iid]?.[m] || 0), 0));
  const realItem = (iid: string, p: Prestacao) => round2(execucoes.filter(e => e.itemProjetoId === iid && e.mes >= p.mesInicio && e.mes <= p.mesFim).reduce((s, e) => s + (e.quantidade || 0), 0));
  const execsDo = (p: Prestacao) => execucoes.filter(e => e.mes >= p.mesInicio && e.mes <= p.mesFim);

  const totalOrcado = round2(itens.reduce((s, it) => s + ((it.valorTotal || (it.quantidade * (it.valorUnitario || 0))) || 0), 0));
  const totalExecAll = round2(execucoes.reduce((s, e) => s + (e.quantidade || 0) * valorUnitDe(e.itemProjetoId), 0));
  const saldoDevolver = round2(totalOrcado - totalExecAll);

  const gerarNarrativaIA = async () => {
    if (!sel || !projeto) return;
    setGerandoIA(true);
    try {
      const grps: EtapaProjeto[] = [...etapas, ...(itens.some(it => !it.etapaId) ? [{ id: '', nome: 'Sem etapa' } as EtapaProjeto] : [])];
      const linhas: string[] = [];
      grps.forEach((et, gi) => {
        const itensEt = itens.filter(it => (it.etapaId || '') === et.id && (prevItem(it.id, sel) > 0 || realItem(it.id, sel) > 0));
        if (!itensEt.length) return;
        linhas.push(`${et.id ? `${gi + 1}.0 ` : ''}${et.nome}:`);
        itensEt.forEach(it => linhas.push(`  - ${it.nome}: previsto ${prevItem(it.id, sel)} ${it.unidade}, realizado ${realItem(it.id, sel)} ${it.unidade}`));
      });
      const pa = projeto.publicoAlvo ? [projeto.publicoAlvo.direto, projeto.publicoAlvo.faixaEtaria].filter(Boolean).join(' · ') : '';
      const r = await gerarPrestacaoContas({
        tituloProjeto: projeto.titulo || '', objetivoGeral: projeto.objetivoGeral,
        periodo: `${rotuloMes(sel.mesInicio, projeto.mesInicio)}–${rotuloMes(sel.mesFim, projeto.mesInicio)} (${sel.tipo})`,
        publicoAlvo: pa, modalidades: (projeto.modalidades || []).map(m => m.nome),
        metasQualitativas: (projeto.metasQualitativas || []).map(m => ({ meta: m.meta, indicador: m.indicador, verificacao: m.verificacao })),
        metasQuantitativas: (projeto.metasQuantitativas || []).map(m => ({ meta: m.meta, indicador: m.indicador, verificacao: m.verificacao })),
        demonstrativo: linhas.join('\n'),
        totalOrcado, totalExecutado: totalExecAll, saldoDevolver,
        remanejamento: projeto.justificativaRemanejamento,
      });
      setSel({ ...sel, resumoExecutivo: r.resumoExecutivo || sel.resumoExecutivo, metasAtingidas: r.metasAtingidas || sel.metasAtingidas, dificuldades: r.dificuldades || sel.dificuldades });
    } catch (e: any) { alert('Erro ao gerar narrativa: ' + (e?.message || e)); }
    finally { setGerandoIA(false); }
  };

  const toggle = (iid: string) => setExpandido(prev => { const s = new Set(prev); s.has(iid) ? s.delete(iid) : s.add(iid); return s; });
  const imprimir = () => {
    if (!sel || !projeto) return;
    gerarPrestacaoPdf({ projeto, prestacao: sel, itens, etapas, execucoes, fornecedores, previsto, entidadeNome, totalOrcado, totalExecutado: totalExecAll, saldoDevolver });
  };

  if (loading) return <div className="p-6 flex items-center gap-2 text-lie-gray"><Loader2 className="w-5 h-5 animate-spin" /> Carregando…</div>;

  // ===== LISTA / CRIAÇÃO =====
  if (!sel) {
    return (
      <div className="p-6 max-w-4xl mx-auto pb-20">
        {id && <ProjetoWorkspaceNav projetoId={id} active="prestacao" status={projeto?.status} />}
        <header className="mb-4"><h1 className="text-2xl font-bold text-lie-ink">Prestação de Contas</h1><p className="text-sm text-lie-gray">Crie quantas prestações o órgão exigir (parciais ou final). Cada uma consome a execução do período automaticamente.</p></header>

        <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4 shadow-sm">
          <div className="text-sm font-bold text-lie-ink mb-2">Nova prestação</div>
          <div className="grid sm:grid-cols-4 gap-2 items-end">
            <div><label className="block text-[11px] font-bold text-gray-600 mb-1">Tipo</label><select value={novoTipo} onChange={e => setNovoTipo(e.target.value as any)} className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm"><option value="final">Final</option><option value="parcial">Parcial</option></select></div>
            <div><label className="block text-[11px] font-bold text-gray-600 mb-1">Mês início</label><select value={novoMesIni} onChange={e => setNovoMesIni(Number(e.target.value))} className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm">{meses.map(m => <option key={m} value={m}>{rotuloMes(m, projeto?.mesInicio)}</option>)}</select></div>
            <div><label className="block text-[11px] font-bold text-gray-600 mb-1">Mês fim</label><select value={novoMesFim} onChange={e => setNovoMesFim(Number(e.target.value))} className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm">{meses.map(m => <option key={m} value={m}>{rotuloMes(m, projeto?.mesInicio)}</option>)}</select></div>
            <button onClick={novaPrestacao} className="flex items-center justify-center gap-1.5 bg-lie-green hover:bg-lie-greenDark text-white px-4 py-2 rounded-lg font-bold"><Plus className="w-4 h-4" /> Criar</button>
          </div>
        </div>

        {prestacoes.length === 0 ? (
          <div className="bg-white border border-dashed border-gray-300 rounded-xl p-10 text-center text-gray-400"><FileText className="w-10 h-10 mx-auto mb-2 text-gray-300" />Nenhuma prestação ainda.</div>
        ) : (
          <div className="space-y-2">
            {prestacoes.sort((a, b) => a.mesInicio - b.mesInicio).map(p => (
              <div key={p.id} className="bg-white border border-gray-200 rounded-xl p-3 flex items-center justify-between gap-3 hover:border-lie-green transition cursor-pointer" onClick={() => setSel(p)}>
                <div className="flex items-center gap-3 min-w-0">
                  <FileText className="w-5 h-5 text-lie-green shrink-0" />
                  <div className="min-w-0"><div className="font-bold text-lie-ink truncate">{p.titulo}</div><div className="text-[11px] text-gray-400">{p.tipo === 'final' ? 'Final' : 'Parcial'} · {rotuloMes(p.mesInicio, projeto?.mesInicio)}–{rotuloMes(p.mesFim, projeto?.mesInicio)}</div></div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${STATUS_INFO[p.status].cls}`}>{STATUS_INFO[p.status].label}</span>
                  <button onClick={e => { e.stopPropagation(); removerPrestacao(p); }} className="p-1 text-red-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ===== DETALHE DE UMA PRESTAÇÃO =====
  const grupos: EtapaProjeto[] = [...etapas, ...(itens.some(it => !it.etapaId) ? [{ id: '', nome: 'Sem etapa' } as EtapaProjeto] : [])];
  const execs = execsDo(sel);
  return (
    <div className="p-6 max-w-5xl mx-auto pb-20">
      {id && <ProjetoWorkspaceNav projetoId={id} active="prestacao" status={projeto?.status} />}
      <button onClick={() => setSel(null)} className="flex items-center gap-1 text-sm font-semibold text-lie-gray hover:text-lie-ink mb-2"><ChevronLeft className="w-4 h-4" /> Todas as prestações</button>
      <header className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-lie-ink">{sel.titulo}</h1>
          <p className="text-sm text-lie-gray">{sel.tipo === 'final' ? 'Prestação Final' : 'Prestação Parcial'} · {rotuloMes(sel.mesInicio, projeto?.mesInicio)}–{rotuloMes(sel.mesFim, projeto?.mesInicio)}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${STATUS_INFO[sel.status].cls}`}>{STATUS_INFO[sel.status].label}</span>
          <button onClick={imprimir} className="flex items-center gap-1.5 bg-lie-ink hover:bg-lie-ink/90 text-white px-3 py-1.5 rounded-lg text-sm font-bold" title="Gerar PDF da prestação (imprimir todos)"><Printer className="w-4 h-4" /> Imprimir todos</button>
          {sel.status === 'em_elaboracao' && <button onClick={() => mudarStatus('submetida')} className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-sm font-bold"><Send className="w-4 h-4" /> Submeter</button>}
        </div>
      </header>

      {/* Demonstrativo físico-financeiro */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4 shadow-sm">
        <h2 className="text-sm font-bold text-lie-ink mb-2">Demonstrativo físico-financeiro do período</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-gray-500 uppercase tracking-wider text-[10px] border-b border-gray-100"><th className="text-left py-1.5">Etapa / Item</th><th className="text-right">Prev. qtd</th><th className="text-right">Real. qtd</th><th className="text-right">Prev. R$</th><th className="text-right">Real. R$</th></tr></thead>
            <tbody>
              {grupos.map((et, gi) => {
                const itensEt = itens.filter(it => (it.etapaId || '') === et.id && (prevItem(it.id, sel) > 0 || realItem(it.id, sel) > 0));
                if (itensEt.length === 0) return null;
                return (
                  <Fragment key={et.id || 'sem'}>
                    <tr className="bg-lie-ink/5"><td colSpan={5} className="px-1 py-1 font-bold text-lie-ink text-[11px] uppercase">{et.id ? `${gi + 1}.0 — ` : ''}{et.nome}</td></tr>
                    {itensEt.map(it => {
                      const pq = prevItem(it.id, sel), rq = realItem(it.id, sel), vu = it.valorUnitario || 0;
                      const exItem = execucoes.filter(e => e.itemProjetoId === it.id && e.mes >= sel.mesInicio && e.mes <= sel.mesFim);
                      const open = expandido.has(it.id);
                      return (
                        <Fragment key={it.id}>
                          <tr className="border-b border-gray-50 hover:bg-gray-50/50">
                            <td className="py-1 pl-2 text-lie-ink">
                              <button onClick={() => toggle(it.id)} className="inline-flex items-center gap-1 hover:text-lie-green text-left">
                                {open ? <ChevronUp className="w-3 h-3 shrink-0" /> : <ChevronDown className="w-3 h-3 shrink-0" />}
                                {it.nome} <span className="text-gray-400">({it.unidade})</span>
                                {exItem.length > 0 && <span className="text-[9px] text-gray-400">· {exItem.length} exec.</span>}
                              </button>
                            </td>
                            <td className="text-right text-gray-600">{pq}</td>
                            <td className="text-right font-bold text-lie-green">{rq}</td>
                            <td className="text-right font-mono text-gray-600">{FMT(pq * vu)}</td>
                            <td className="text-right font-mono font-bold text-lie-ink">{FMT(rq * vu)}</td>
                          </tr>
                          {open && (
                            <tr className="bg-gray-50/60"><td colSpan={5} className="px-3 py-2">
                              {exItem.length === 0 ? <span className="text-[11px] text-gray-400">Nenhuma execução deste item no período.</span> : (
                                <div className="space-y-1">
                                  {exItem.map(e => (
                                    <div key={e.id} className="flex items-center gap-2 text-[11px]">
                                      <span className="text-gray-400">{rotuloMes(e.mes, projeto?.mesInicio)}</span>
                                      <span className="font-semibold text-lie-ink">{e.quantidade} {it.unidade}</span>
                                      <span className="flex items-center gap-1 text-gray-600"><Building2 className="w-3 h-3" />{fornecedorNome(e.fornecedorId)}</span>
                                      <span className="flex items-center gap-1.5 ml-auto"><Doc url={e.notaFiscalUrl} s="NF" /><Doc url={e.certidoesUrl} s="Cert." /><Doc url={e.pagamentoUrl} s="Pgto" /></span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </td></tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Resumo financeiro do projeto */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-white border border-gray-200 rounded-xl p-3 text-center"><div className="text-[11px] uppercase text-gray-500 font-bold">Valor inicial</div><div className="text-lg font-bold text-lie-ink font-mono">{FMT(totalOrcado)}</div></div>
        <div className="bg-white border border-gray-200 rounded-xl p-3 text-center"><div className="text-[11px] uppercase text-gray-500 font-bold">Executado (total)</div><div className="text-lg font-bold text-lie-green font-mono">{FMT(totalExecAll)}</div></div>
        <div className="bg-white border border-gray-200 rounded-xl p-3 text-center"><div className="text-[11px] uppercase text-gray-500 font-bold">Saldo a devolver</div><div className="text-lg font-bold text-amber-600 font-mono">{FMT(saldoDevolver)}</div></div>
      </div>

      {/* Relação de documentos do período */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4 shadow-sm">
        <h2 className="text-sm font-bold text-lie-ink mb-2">Relação de pagamentos e documentos ({execs.length})</h2>
        {execs.length === 0 ? <div className="text-xs text-gray-400">Nenhuma execução no período.</div> : (
          <div className="space-y-1">
            {execs.map(e => {
              const it = itens.find(i => i.id === e.itemProjetoId);
              return (
                <div key={e.id} className="flex items-center gap-2 text-xs bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-1.5">
                  <span className="text-gray-400">{rotuloMes(e.mes, projeto?.mesInicio)}</span>
                  <span className="font-semibold text-lie-ink truncate">{it?.nome || '—'}</span>
                  <span className="text-gray-500">{e.quantidade} {it?.unidade}</span>
                  <span className="flex items-center gap-1 text-gray-600"><Building2 className="w-3 h-3" />{fornecedorNome(e.fornecedorId)}</span>
                  <span className="flex items-center gap-1.5 ml-auto">
                    <Doc url={e.notaFiscalUrl} s="NF" /><Doc url={e.certidoesUrl} s="Cert." /><Doc url={e.pagamentoUrl} s="Pgto" />
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Remanejamento + justificativa (registro do projeto) */}
      {projeto?.justificativaRemanejamento && (
        <div className="bg-white border border-amber-200 rounded-xl p-4 mb-4 shadow-sm">
          <h2 className="text-sm font-bold text-lie-ink mb-1 flex items-center gap-1.5"><Layers className="w-4 h-4 text-amber-500" /> Remanejamento</h2>
          <p className="text-xs text-gray-600 whitespace-pre-wrap">{projeto.justificativaRemanejamento}</p>
        </div>
      )}

      {/* Narrativa (mista — IA na próxima etapa) */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-lie-ink">Relatório de cumprimento do objeto</h2>
          <button onClick={gerarNarrativaIA} disabled={gerandoIA} className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-sm font-bold">
            {gerandoIA ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />} {gerandoIA ? 'Gerando…' : 'Gerar com IA'}
          </button>
        </div>
        {([
          ['Resumo executivo', 'resumoExecutivo'],
          ['Metas atingidas', 'metasAtingidas'],
          ['Dificuldades encontradas', 'dificuldades'],
          ['Observações', 'observacoes'],
        ] as [string, keyof Prestacao][]).map(([label, campo]) => (
          <div key={campo}>
            <label className="block text-[11px] font-bold text-gray-600 mb-1">{label}</label>
            <AutoResizeTextarea minRows={2} value={(sel[campo] as string) || ''} onChange={e => setSel({ ...sel, [campo]: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
        ))}
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-gray-400">A IA preenche resumo, metas atingidas e dificuldades a partir das metas + execução. "Observações" é sempre manual.</span>
          <button onClick={salvarNarrativa} disabled={salvando} className="flex items-center gap-2 bg-lie-green hover:bg-lie-greenDark text-white px-5 py-2 rounded-lg font-bold disabled:opacity-50">
            {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Salvar prestação
          </button>
        </div>
      </div>
    </div>
  );
}

function Doc({ url, s }: { url: string; s: string }) {
  if (!url) return <span className="text-[10px] text-gray-300 border border-gray-200 rounded px-1">{s}</span>;
  return <a href={url} target="_blank" rel="noopener noreferrer" className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1 inline-flex items-center gap-0.5 hover:bg-emerald-100"><FileCheck2 className="w-3 h-3" />{s}</a>;
}
