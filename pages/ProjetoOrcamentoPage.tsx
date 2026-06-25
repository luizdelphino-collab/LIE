/**
 * pages/ProjetoOrcamentoPage.tsx
 *
 * "Fase 2" da elaboração — Itens, Orçamento & Cronograma numa GRADE ÚNICA,
 * agrupada por ETAPA › TIPO (replanejamento 2026-06). Substitui as telas
 * separadas de Itens e Cronograma.
 *
 * - Etapas: lista definida pelo usuário no projeto (fases de execução).
 * - Tipo: a categoria que o item já tem no catálogo (Alimento, Material Esportivo…).
 * - Linhas = itens; colunas = meses. Quantidade por mês; total do item = soma;
 *   R$ = total × valor unitário. Subtotais por Tipo e por Etapa + total do projeto.
 * Ao salvar: grava etapas no projeto, os ItemProjeto (snapshot) e o cronograma.
 */

import { useEffect, useMemo, useState, Fragment } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  collection, query, getDocs, getDoc, doc, setDoc, writeBatch,
  serverTimestamp, orderBy, Timestamp,
} from 'firebase/firestore';
import {
  Plus, Search, Trash2, Loader2, Save, Package, X, Sparkles, ChevronRight, Pencil, Layers,
  ShieldCheck, ShieldAlert, Wand2, FileText, ChevronDown, ChevronUp,
} from 'lucide-react';
import { db } from '../lib/firebase';
import type { Projeto, ItemMaster, ItemProjeto, CronogramaItem, CategoriaItem, EtapaProjeto } from '../types';
import ProjetoWorkspaceNav from '../components/ProjetoWorkspaceNav';
import AutoResizeTextarea from '../components/AutoResizeTextarea';
import { gerarMemorialCalculo } from '../lib/planoIaApi';

const FMT = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const MESES_ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const CATEGORIAS: CategoriaItem[] = ['Alimento', 'Transporte', 'Material Esportivo', 'Material não Esportivo', 'Recurso Humano', 'Outro'];

function rotuloMes(n: number, mesInicio?: string): string {
  if (!mesInicio) return `Mês ${n}`;
  const [ay, am] = mesInicio.split('-').map(Number);
  if (!ay || !am) return `Mês ${n}`;
  const idx = (am - 1) + (n - 1);
  return `${MESES_ABREV[idx % 12]}/${String(ay + Math.floor(idx / 12)).slice(2)}`;
}

export default function ProjetoOrcamentoPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [projeto, setProjeto] = useState<Projeto | null>(null);
  const [master, setMaster] = useState<ItemMaster[]>([]);
  const [itens, setItens] = useState<ItemProjeto[]>([]);
  const [etapas, setEtapas] = useState<EtapaProjeto[]>([]);
  const [alloc, setAlloc] = useState<Record<string, Record<number, number>>>({});
  const [removidos, setRemovidos] = useState<string[]>([]);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [etapaAlvo, setEtapaAlvo] = useState<string>(''); // etapa onde o item será adicionado
  const [busca, setBusca] = useState('');
  const [criarOpen, setCriarOpen] = useState(false);
  const [novo, setNovo] = useState({ nome: '', unidade: 'unidade', valorUnitario: 0, categoria: 'Material não Esportivo' as CategoriaItem });
  const [novaEtapa, setNovaEtapa] = useState('');

  const duracao = projeto?.duracaoMeses || 12;
  const meses = useMemo(() => Array.from({ length: duracao }, (_, i) => i + 1), [duracao]);
  const colTotal = meses.length + 5;

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      try {
        const projSnap = await getDoc(doc(db, 'projects', id));
        if (projSnap.exists()) {
          const p = { id: projSnap.id, ...projSnap.data() } as Projeto;
          setProjeto(p);
          setEtapas(p.etapas || []);
        }
        const [itSnap, mSnap, cSnap] = await Promise.all([
          getDocs(query(collection(db, `projects/${id}/items`), orderBy('criadoEm', 'asc'))),
          getDocs(query(collection(db, 'items'))),
          getDocs(collection(db, `projects/${id}/cronograma`)),
        ]);
        const projItems = itSnap.docs.map(d => ({ id: d.id, ...d.data() } as ItemProjeto));
        setItens(projItems);
        setMaster(mSnap.docs.map(d => ({ id: d.id, ...d.data() } as ItemMaster)));
        const a: Record<string, Record<number, number>> = {};
        projItems.forEach(it => { a[it.id] = {}; });
        cSnap.docs.forEach(d => {
          const ci = d.data() as CronogramaItem;
          if (!a[ci.itemProjetoId]) a[ci.itemProjetoId] = {};
          a[ci.itemProjetoId][ci.mes] = ci.quantidade;
        });
        setAlloc(a);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const totalItem = (itemId: string) => round2(Object.values(alloc[itemId] || {}).reduce((s, q) => s + (q || 0), 0));
  const valorItem = (it: ItemProjeto) => round2(totalItem(it.id) * (it.valorUnitario || 0));
  const totalProjeto = round2(itens.reduce((s, it) => s + valorItem(it), 0));
  const subtotalEtapa = (eid: string) => round2(itens.filter(it => (it.etapaId || '') === eid).reduce((s, it) => s + valorItem(it), 0));

  const setCelula = (itemId: string, mes: number, raw: string) => {
    let v = parseFloat(raw);
    if (isNaN(v) || v < 0) v = 0;
    setAlloc(prev => ({ ...prev, [itemId]: { ...(prev[itemId] || {}), [mes]: round2(v) } }));
  };
  const setItemCampo = (itemId: string, patch: Partial<ItemProjeto>) =>
    setItens(prev => prev.map(it => it.id === itemId ? { ...it, ...patch } : it));

  // ---- Memorial de cálculo (expansível + IA) ----
  const [expandido, setExpandido] = useState<Set<string>>(new Set());
  const [gerandoMem, setGerandoMem] = useState<Set<string>>(new Set());
  const toggleExpand = (itemId: string) => setExpandido(prev => {
    const s = new Set(prev); s.has(itemId) ? s.delete(itemId) : s.add(itemId); return s;
  });
  const gerarMemorial = async (it: ItemProjeto) => {
    setGerandoMem(prev => new Set(prev).add(it.id));
    try {
      const a = alloc[it.id] || {};
      const distribuicao = meses.filter(m => (a[m] || 0) > 0).map(m => `${rotuloMes(m, projeto?.mesInicio)}: ${a[m]}`).join('; ');
      const pa = projeto?.publicoAlvo;
      const publicoAlvo = pa ? [pa.direto && `direto: ${pa.direto}`, pa.faixaEtaria && `faixa: ${pa.faixaEtaria}`, pa.indireto && `indireto: ${pa.indireto}`].filter(Boolean).join(' · ') : '';
      const memorial = await gerarMemorialCalculo({
        itemNome: it.nome, unidade: it.unidade, valorUnitario: it.valorUnitario,
        quantidadeTotal: totalItem(it.id), distribuicao,
        tituloProjeto: projeto?.titulo, publicoAlvo,
        modalidades: (projeto?.modalidades || []).map(m => m.nome),
        periodoMeses: projeto?.duracaoMeses, medianaReferencia: it.medianaReferencia,
      });
      if (memorial) { setItemCampo(it.id, { memorialCalculo: memorial }); setExpandido(prev => new Set(prev).add(it.id)); }
    } catch (e: any) {
      alert('Erro ao gerar memorial: ' + (e?.message || e));
    } finally {
      setGerandoMem(prev => { const s = new Set(prev); s.delete(it.id); return s; });
    }
  };

  // ---- Etapas ----
  const addEtapa = () => {
    const nome = novaEtapa.trim();
    if (!nome) return;
    setEtapas(prev => [...prev, { id: doc(collection(db, 'projects')).id, nome, ordem: prev.length }]);
    setNovaEtapa('');
  };
  const renomearEtapa = (eid: string) => {
    const atual = etapas.find(e => e.id === eid)?.nome || '';
    const nome = window.prompt('Nome da etapa:', atual);
    if (nome && nome.trim()) setEtapas(prev => prev.map(e => e.id === eid ? { ...e, nome: nome.trim() } : e));
  };
  const removerEtapa = (eid: string) => {
    if (itens.some(it => it.etapaId === eid) && !window.confirm('Há itens nesta etapa — eles voltam para "Sem etapa". Remover?')) return;
    setEtapas(prev => prev.filter(e => e.id !== eid));
    setItens(prev => prev.map(it => it.etapaId === eid ? { ...it, etapaId: '' } : it));
  };

  // ---- Itens ----
  const abrirPicker = (eid: string) => { setEtapaAlvo(eid); setPickerOpen(true); setCriarOpen(false); setBusca(''); };

  const adicionarDoCatalogo = (m: ItemMaster) => {
    const novoId = doc(collection(db, `projects/${id}/items`)).id;
    const ip: ItemProjeto = {
      id: novoId, projectId: id!, itemId: m.id,
      nome: m.nome, descricao: m.descricao || '', unidade: m.unidade,
      valorUnitario: m.valorUnitario, memorialCalculo: '', quantidade: 0, valorTotal: 0,
      categoria: m.categoria || 'Outro', etapaId: etapaAlvo || '',
      criadoEm: serverTimestamp() as Timestamp,
      ...(m.codigoCatmat ? { codigoCatmat: m.codigoCatmat } : {}),
      ...(m.tipoCatmat ? { tipoCatmat: m.tipoCatmat } : {}),
      ...(m.nomeCatmatOficial ? { nomeCatmatOficial: m.nomeCatmatOficial } : {}),
      ...(m.descricaoCatmatOficial ? { descricaoCatmatOficial: m.descricaoCatmatOficial } : {}),
      ...(m.fatorConversao ? { fatorConversao: m.fatorConversao } : {}),
      ...(m.unidadeBase ? { unidadeBase: m.unidadeBase } : {}),
      ...(m.embalagemDescricao ? { embalagemDescricao: m.embalagemDescricao } : {}),
      ...(m.semCorrespondenciaCatalogo ? { semCorrespondenciaCatalogo: true } : {}),
      // Pesquisa de preço viaja junto com o item (feita no catálogo) — snapshot congelado.
      ...(m.pesquisado ? { pesquisado: true } : {}),
      ...(m.referencias ? { referencias: m.referencias } : {}),
      ...(m.mediaReferencia ? { mediaReferencia: m.mediaReferencia } : {}),
      ...(m.medianaReferencia ? { medianaReferencia: m.medianaReferencia } : {}),
      ...(m.tokenPesquisa ? { tokenPesquisa: m.tokenPesquisa } : {}),
    } as ItemProjeto;
    setItens(prev => [...prev, ip]);
    setAlloc(prev => ({ ...prev, [novoId]: {} }));
    setPickerOpen(false);
  };

  const criarItemInline = async () => {
    if (!novo.nome.trim()) { alert('Informe o nome do item.'); return; }
    const proxCodigo = Math.max(0, ...master.map(m => Number(m.codigo) || 0)) + 1;
    const refMaster = doc(collection(db, 'items'));
    const novoMaster: Partial<ItemMaster> = {
      id: refMaster.id, codigo: proxCodigo, nome: novo.nome.trim(), descricao: '',
      unidade: novo.unidade, valorUnitario: Number(novo.valorUnitario) || 0,
      categoria: novo.categoria, criadoEm: serverTimestamp() as Timestamp,
    };
    await setDoc(refMaster, novoMaster as any);
    const mCompleto = { ...(novoMaster as ItemMaster) };
    setMaster(prev => [...prev, mCompleto]);
    setNovo({ nome: '', unidade: 'unidade', valorUnitario: 0, categoria: 'Material não Esportivo' });
    setCriarOpen(false);
    adicionarDoCatalogo(mCompleto);
  };

  const removerItem = (it: ItemProjeto) => {
    setItens(prev => prev.filter(x => x.id !== it.id));
    setAlloc(prev => { const c = { ...prev }; delete c[it.id]; return c; });
    setRemovidos(prev => [...prev, it.id]);
  };

  const salvar = async () => {
    if (!id) return;
    setSaving(true);
    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'projects', id), { etapas }, { merge: true });
      for (const rid of removidos) batch.delete(doc(db, `projects/${id}/items`, rid));
      for (const it of itens) {
        const qtd = totalItem(it.id);
        batch.set(doc(db, `projects/${id}/items`, it.id), {
          ...it, etapaId: it.etapaId || '', categoria: it.categoria || 'Outro',
          quantidade: qtd, valorTotal: round2(qtd * (it.valorUnitario || 0)),
        } as any, { merge: true });
      }
      const cronAntigo = await getDocs(collection(db, `projects/${id}/cronograma`));
      cronAntigo.docs.forEach(d => batch.delete(d.ref));
      for (const it of itens) {
        for (const [mesStr, q] of Object.entries(alloc[it.id] || {})) {
          if (q > 0) {
            const ref = doc(collection(db, `projects/${id}/cronograma`));
            batch.set(ref, {
              id: ref.id, projectId: id, itemProjetoId: it.id, mes: parseInt(mesStr),
              quantidade: q, valorTotal: round2(q * (it.valorUnitario || 0)), criadoEm: serverTimestamp(),
            } as any);
          }
        }
      }
      await batch.commit();
      setRemovidos([]);
      alert('Itens, orçamento e cronograma salvos com sucesso!');
    } catch (e: any) {
      console.error(e);
      alert('Erro ao salvar: ' + (e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  const masterFiltrado = master
    .filter(m => !busca || `${m.nome} ${m.codigo} ${m.categoria}`.toLowerCase().includes(busca.toLowerCase()))
    .slice(0, 50);

  // Grupos a renderizar: etapas definidas + "Sem etapa" (se houver itens órfãos)
  const grupos: EtapaProjeto[] = [
    ...etapas,
    ...(itens.some(it => !it.etapaId) ? [{ id: '', nome: 'Sem etapa' } as EtapaProjeto] : []),
  ];

  if (loading) return <div className="p-6 flex items-center gap-2 text-lie-gray"><Loader2 className="w-5 h-5 animate-spin" /> Carregando…</div>;

  return (
    <div className="p-6 max-w-[1500px] mx-auto pb-32">
      {id && <ProjetoWorkspaceNav projetoId={id} active="itens" status={projeto?.status} />}

      <header className="mb-4">
        <h1 className="text-2xl font-bold text-lie-ink">Itens, Orçamento & Cronograma</h1>
        <p className="text-sm text-lie-gray">Organize os itens por etapa e tipo, e distribua as quantidades pelos meses.</p>
      </header>

      {/* Gerenciador de Etapas */}
      <div className="mb-4 bg-white border border-gray-200 rounded-xl p-3 shadow-sm">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-gray-500"><Layers className="w-4 h-4" /> Etapas:</span>
          {etapas.map(e => (
            <span key={e.id} className="flex items-center gap-1 bg-lie-green/10 text-lie-ink text-sm font-semibold px-2.5 py-1 rounded-full">
              {e.nome}
              <button onClick={() => renomearEtapa(e.id)} className="text-gray-400 hover:text-lie-green" title="Renomear"><Pencil className="w-3 h-3" /></button>
              <button onClick={() => removerEtapa(e.id)} className="text-gray-400 hover:text-red-500" title="Remover"><X className="w-3 h-3" /></button>
            </span>
          ))}
          <div className="flex items-center gap-1">
            <input value={novaEtapa} onChange={e => setNovaEtapa(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addEtapa(); }}
              placeholder="Nova etapa (ex: Mobilização)" className="border border-gray-300 rounded-lg px-2.5 py-1 text-sm w-48" />
            <button onClick={addEtapa} className="flex items-center gap-1 text-sm font-bold text-lie-green hover:underline"><Plus className="w-4 h-4" /> Etapa</button>
          </div>
        </div>
      </div>

      {/* Picker */}
      {pickerOpen && (
        <div className="mb-4 border-2 border-lie-green/30 rounded-xl bg-white shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 bg-lie-green/5 border-b border-gray-100">
            <span className="text-sm font-bold text-lie-ink">Adicionar item {etapaAlvo ? <>na etapa <span className="text-lie-green">{etapas.find(e => e.id === etapaAlvo)?.nome}</span></> : '(sem etapa)'}</span>
            <button onClick={() => { setPickerOpen(false); setCriarOpen(false); }} className="text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
          </div>
          {!criarOpen ? (
            <div className="p-3">
              <div className="flex items-center gap-2 mb-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input autoFocus value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar item no catálogo…" className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <button onClick={() => setCriarOpen(true)} className="flex items-center gap-1.5 text-sm font-bold text-violet-700 bg-violet-50 border border-violet-200 px-3 py-2 rounded-lg hover:bg-violet-100 whitespace-nowrap"><Sparkles className="w-4 h-4" /> Criar item novo</button>
              </div>
              <div className="max-h-60 overflow-y-auto divide-y divide-gray-100 border border-gray-100 rounded-lg">
                {masterFiltrado.map(m => (
                  <button key={m.id} onClick={() => adicionarDoCatalogo(m)} className="w-full text-left p-2.5 hover:bg-lie-green/5 flex items-center gap-3">
                    <span className="text-[10px] font-mono text-gray-400">#{String(m.codigo).padStart(3, '0')}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-lie-ink truncate">{m.nome}</div>
                      <div className="text-[11px] text-gray-500">{m.categoria} · {m.unidade} · {FMT(m.valorUnitario || 0)}</div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-300" />
                  </button>
                ))}
                {masterFiltrado.length === 0 && <div className="p-4 text-center text-xs text-gray-400">Nada no catálogo. Use "Criar item novo".</div>}
              </div>
            </div>
          ) : (
            <div className="p-3 grid sm:grid-cols-12 gap-2 items-end">
              <div className="sm:col-span-5"><label className="block text-[11px] font-bold text-gray-600 mb-1">Nome *</label><input autoFocus value={novo.nome} onChange={e => setNovo(p => ({ ...p, nome: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-2.5 py-2 text-sm" placeholder="Ex: Locação de tenda 3x3" /></div>
              <div className="sm:col-span-2"><label className="block text-[11px] font-bold text-gray-600 mb-1">Unidade</label><input value={novo.unidade} onChange={e => setNovo(p => ({ ...p, unidade: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-2.5 py-2 text-sm" /></div>
              <div className="sm:col-span-2"><label className="block text-[11px] font-bold text-gray-600 mb-1">Valor (R$)</label><input type="number" step="0.01" value={novo.valorUnitario} onChange={e => setNovo(p => ({ ...p, valorUnitario: parseFloat(e.target.value) || 0 }))} className="w-full border border-gray-300 rounded-lg px-2.5 py-2 text-sm" /></div>
              <div className="sm:col-span-2"><label className="block text-[11px] font-bold text-gray-600 mb-1">Tipo</label><select value={novo.categoria} onChange={e => setNovo(p => ({ ...p, categoria: e.target.value as CategoriaItem }))} className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm">{CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
              <div className="sm:col-span-1"><button onClick={criarItemInline} className="w-full bg-violet-600 hover:bg-violet-700 text-white rounded-lg py-2 text-sm font-bold">Criar</button></div>
            </div>
          )}
        </div>
      )}

      {/* Grade agrupada Etapa › Tipo */}
      {itens.length === 0 && grupos.length === 0 ? (
        <div className="bg-white border border-dashed border-gray-300 rounded-xl p-10 text-center text-gray-400">
          <Package className="w-10 h-10 mx-auto mb-2 text-gray-300" />
          Crie uma <strong>etapa</strong> acima e adicione itens nela.
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50 text-[11px] uppercase tracking-wider text-gray-500">
                  <th className="text-left px-3 py-2 sticky left-0 bg-gray-50 z-10 min-w-[260px]">Item / Tipo / Etapa</th>
                  <th className="text-right px-2 py-2 whitespace-nowrap">Valor unit.</th>
                  {meses.map(m => <th key={m} className="px-1 py-2 text-center min-w-[58px]" title={`Mês ${m}`}>{rotuloMes(m, projeto?.mesInicio)}</th>)}
                  <th className="text-right px-2 py-2">Qtd</th>
                  <th className="text-right px-2 py-2 whitespace-nowrap">Total R$</th>
                  <th className="px-1 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {grupos.map((etapa, gi) => {
                  const itensEtapa = itens.filter(it => (it.etapaId || '') === etapa.id);
                  const tipos = CATEGORIAS.filter(c => itensEtapa.some(it => (it.categoria || 'Outro') === c));
                  const numEtapa = gi + 1;
                  return (
                    <Fragment key={etapa.id || 'sem'}>
                      {/* Cabeçalho da Etapa */}
                      <tr key={`et-${etapa.id || 'sem'}`} className="bg-lie-ink/5">
                        <td colSpan={colTotal - 1} className="px-3 py-2 sticky left-0 bg-lie-ink/5 z-10">
                          {etapa.id !== '' && <span className="font-mono font-bold text-lie-green mr-2">{numEtapa}.0</span>}<span className="font-bold text-lie-ink uppercase text-[12px] tracking-wide">{etapa.nome}</span>
                          {etapa.id !== '' && (
                            <button onClick={() => abrirPicker(etapa.id)} className="ml-3 text-[11px] font-bold text-lie-green hover:underline"><Plus className="w-3 h-3 inline" /> adicionar item</button>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right font-bold text-lie-ink whitespace-nowrap">{FMT(subtotalEtapa(etapa.id))}</td>
                      </tr>
                      {tipos.map((tipo, ti) => (
                        <Fragment key={`${etapa.id}-${tipo}`}>
                          <tr key={`tp-${etapa.id}-${tipo}`} className="bg-gray-50/70">
                            <td colSpan={colTotal} className="px-3 py-1 sticky left-0 bg-gray-50/70 z-10 text-[11px] font-bold uppercase tracking-wider text-gray-500">
                              {etapa.id !== '' && <span className="text-lie-green/80 mr-1">{numEtapa}.{ti + 1}</span>}{tipo}
                            </td>
                          </tr>
                          {itensEtapa.filter(it => (it.categoria || 'Outro') === tipo).map((it, ii) => (
                            <Fragment key={it.id}>
                            <tr className="hover:bg-gray-50/50">
                              <td className="px-3 py-2 sticky left-0 bg-white z-10">
                                <div className="font-semibold text-lie-ink leading-tight">{etapa.id !== '' && <span className="font-mono text-[11px] text-gray-400 mr-1.5">{numEtapa}.{ti + 1}.{ii + 1}</span>}{it.nome}</div>
                                <div className="flex items-center gap-1 mt-1">
                                  <select value={it.etapaId || ''} onChange={e => setItemCampo(it.id, { etapaId: e.target.value })} className="text-[10px] border border-gray-200 rounded px-1 py-0.5 text-gray-500">
                                    <option value="">Sem etapa</option>
                                    {etapas.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
                                  </select>
                                  <select value={it.categoria || 'Outro'} onChange={e => setItemCampo(it.id, { categoria: e.target.value })} className="text-[10px] border border-gray-200 rounded px-1 py-0.5 text-gray-500">
                                    {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
                                  </select>
                                  <span className="text-[10px] text-gray-400">{it.unidade}</span>
                                  {it.pesquisado ? (
                                    <span className="inline-flex items-center gap-0.5 text-[9px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1 rounded" title={it.medianaReferencia ? `Pesquisa de preço vinculada · mediana ${FMT(it.medianaReferencia)}` : 'Pesquisa de preço vinculada'}>
                                      <ShieldCheck className="w-3 h-3" /> pesquisado
                                    </span>
                                  ) : (
                                    <a href="#/itens" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1 rounded hover:bg-amber-100" title="Item sem pesquisa de preço — vincule no Banco de Itens (⚖️)">
                                      <ShieldAlert className="w-3 h-3" /> sem pesquisa
                                    </a>
                                  )}
                                  <button type="button" onClick={() => toggleExpand(it.id)} className="inline-flex items-center gap-0.5 text-[9px] font-bold text-violet-700 bg-violet-50 border border-violet-200 px-1 rounded hover:bg-violet-100" title="Memorial de cálculo">
                                    <FileText className="w-3 h-3" /> memorial{it.memorialCalculo ? <span className="text-emerald-600 ml-0.5">✓</span> : ''}
                                    {expandido.has(it.id) ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                  </button>
                                </div>
                              </td>
                              <td className="px-2 py-2 text-right text-gray-600 whitespace-nowrap font-mono text-[12px]">{FMT(it.valorUnitario || 0)}</td>
                              {meses.map(m => (
                                <td key={m} className="px-0.5 py-1">
                                  <input type="number" min={0} step="0.01" value={alloc[it.id]?.[m] || ''} onChange={e => setCelula(it.id, m, e.target.value)}
                                    className="w-[54px] text-center border border-gray-200 rounded px-1 py-1 text-[12px] focus:border-lie-green focus:ring-1 focus:ring-lie-green/30" placeholder="0" />
                                </td>
                              ))}
                              <td className="px-2 py-2 text-right font-bold text-lie-ink whitespace-nowrap">{totalItem(it.id) || 0}</td>
                              <td className="px-2 py-2 text-right font-bold text-lie-green whitespace-nowrap font-mono text-[12px]">{FMT(valorItem(it))}</td>
                              <td className="px-1 py-2 text-center"><button onClick={() => removerItem(it)} className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded" title="Remover"><Trash2 className="w-4 h-4" /></button></td>
                            </tr>
                            {expandido.has(it.id) && (
                              <tr className="bg-violet-50/40">
                                <td colSpan={colTotal} className="px-4 py-3">
                                  <div className="flex items-start gap-3">
                                    <div className="flex-1">
                                      <div className="text-[11px] font-bold uppercase tracking-wider text-violet-700 mb-1">Memorial de cálculo — {numEtapa}.{ti + 1}.{ii + 1} {it.nome}</div>
                                      <AutoResizeTextarea minRows={2} value={it.memorialCalculo || ''} onChange={e => setItemCampo(it.id, { memorialCalculo: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="Justifique a quantidade (ex.: 5 unid. × 2.200 participantes × 6 eventos = 66.000) — ou gere com IA." />
                                    </div>
                                    <button type="button" onClick={() => gerarMemorial(it)} disabled={gerandoMem.has(it.id)} className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white px-3 py-2 rounded-lg text-sm font-bold whitespace-nowrap mt-5">
                                      {gerandoMem.has(it.id) ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />} Gerar com IA
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            )}
                            </Fragment>
                          ))}
                        </Fragment>
                      ))}
                      {itensEtapa.length === 0 && etapa.id !== '' && (
                        <tr key={`vazio-${etapa.id}`}><td colSpan={colTotal} className="px-3 py-2 text-[12px] text-gray-400 italic sticky left-0 bg-white">Nenhum item nesta etapa — clique em "adicionar item" acima.</td></tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-lie-green/5 font-bold text-lie-ink">
                  <td className="px-3 py-2.5 sticky left-0 bg-lie-green/5 z-10">Total do projeto</td>
                  <td colSpan={colTotal - 3}></td>
                  <td className="px-2 py-2.5 text-right text-lie-green font-mono whitespace-nowrap">{FMT(totalProjeto)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Barra fixa */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-6 py-3 flex items-center justify-between shadow-lg z-20">
        <div className="text-sm text-lie-gray">{itens.length} {itens.length === 1 ? 'item' : 'itens'} · {etapas.length} etapas · total <strong className="text-lie-ink">{FMT(totalProjeto)}</strong></div>
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(`/projetos/${id}`)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium">Voltar à visão geral</button>
          <button onClick={salvar} disabled={saving} className="flex items-center gap-2 bg-lie-green hover:bg-lie-greenDark disabled:opacity-50 text-white px-6 py-2 rounded-lg font-bold shadow-sm">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}{saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}
