/**
 * pages/ProjetoOrcamentoPage.tsx
 *
 * "Fase 2" da elaboração — Itens, Orçamento & Cronograma numa GRADE ÚNICA
 * (replanejamento 2026-06). Substitui as telas separadas de Itens e Cronograma.
 *
 * Linhas = itens; colunas = meses do projeto. Você adiciona o item (do catálogo
 * ou cria na hora), digita a quantidade em cada mês que ele é executado; total do
 * item = soma dos meses; R$ = total × valor unitário; total do projeto = soma.
 * Ao salvar, grava os ItemProjeto (snapshot congelado) e o cronograma físico-financeiro.
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  collection, query, getDocs, getDoc, doc, setDoc, deleteDoc, writeBatch,
  serverTimestamp, orderBy, Timestamp,
} from 'firebase/firestore';
import {
  Plus, Search, Trash2, Loader2, Save, Package, X, Sparkles, ChevronRight,
} from 'lucide-react';
import { db } from '../lib/firebase';
import type { Projeto, ItemMaster, ItemProjeto, CronogramaItem, CategoriaItem } from '../types';
import ProjetoWorkspaceNav from '../components/ProjetoWorkspaceNav';

const FMT = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const MESES_ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const CATEGORIAS: CategoriaItem[] = ['Alimento', 'Transporte', 'Material Esportivo', 'Material não Esportivo', 'Recurso Humano', 'Outro'];

// Rótulo do mês N (1-based) a partir do mesInicio "AAAA-MM".
function rotuloMes(n: number, mesInicio?: string): string {
  if (!mesInicio) return `Mês ${n}`;
  const [ay, am] = mesInicio.split('-').map(Number);
  if (!ay || !am) return `Mês ${n}`;
  const idx = (am - 1) + (n - 1);
  const ano = ay + Math.floor(idx / 12);
  return `${MESES_ABREV[idx % 12]}/${String(ano).slice(2)}`;
}

export default function ProjetoOrcamentoPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [projeto, setProjeto] = useState<Projeto | null>(null);
  const [master, setMaster] = useState<ItemMaster[]>([]);
  const [itens, setItens] = useState<ItemProjeto[]>([]);
  // allocations[itemProjetoId][mes] = quantidade
  const [alloc, setAlloc] = useState<Record<string, Record<number, number>>>({});
  const [removidos, setRemovidos] = useState<string[]>([]); // ids existentes no DB removidos

  const [pickerOpen, setPickerOpen] = useState(false);
  const [busca, setBusca] = useState('');
  const [criarOpen, setCriarOpen] = useState(false);
  const [novo, setNovo] = useState({ nome: '', unidade: 'unidade', valorUnitario: 0, categoria: 'Material não Esportivo' as CategoriaItem });

  const duracao = projeto?.duracaoMeses || 12;
  const meses = useMemo(() => Array.from({ length: duracao }, (_, i) => i + 1), [duracao]);

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      try {
        const projSnap = await getDoc(doc(db, 'projects', id));
        if (projSnap.exists()) setProjeto({ id: projSnap.id, ...projSnap.data() } as Projeto);

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

  const setCelula = (itemId: string, mes: number, raw: string) => {
    let v = parseFloat(raw);
    if (isNaN(v) || v < 0) v = 0;
    v = round2(v);
    setAlloc(prev => ({ ...prev, [itemId]: { ...(prev[itemId] || {}), [mes]: v } }));
  };

  // Adiciona um ItemMaster ao projeto (snapshot congelado), ainda em memória.
  const adicionarDoCatalogo = (m: ItemMaster) => {
    if (itens.some(it => it.itemId === m.id)) { alert('Esse item já está no projeto.'); return; }
    const novoId = doc(collection(db, `projects/${id}/items`)).id;
    const ip: ItemProjeto = {
      id: novoId,
      projectId: id!,
      itemId: m.id,
      nome: m.nome,
      descricao: m.descricao || '',
      unidade: m.unidade,
      valorUnitario: m.valorUnitario,
      memorialCalculo: '',
      quantidade: 0,
      valorTotal: 0,
      criadoEm: serverTimestamp() as Timestamp,
      ...(m.codigoCatmat ? { codigoCatmat: m.codigoCatmat } : {}),
      ...(m.tipoCatmat ? { tipoCatmat: m.tipoCatmat } : {}),
      ...(m.nomeCatmatOficial ? { nomeCatmatOficial: m.nomeCatmatOficial } : {}),
      ...(m.descricaoCatmatOficial ? { descricaoCatmatOficial: m.descricaoCatmatOficial } : {}),
      ...(m.fatorConversao ? { fatorConversao: m.fatorConversao } : {}),
      ...(m.unidadeBase ? { unidadeBase: m.unidadeBase } : {}),
      ...(m.embalagemDescricao ? { embalagemDescricao: m.embalagemDescricao } : {}),
      ...(m.semCorrespondenciaCatalogo ? { semCorrespondenciaCatalogo: true } : {}),
    } as ItemProjeto;
    setItens(prev => [...prev, ip]);
    setAlloc(prev => ({ ...prev, [novoId]: {} }));
    setPickerOpen(false);
    setBusca('');
  };

  // Cria um item novo no catálogo (item no contexto) e adiciona ao projeto.
  const criarItemInline = async () => {
    if (!novo.nome.trim()) { alert('Informe o nome do item.'); return; }
    const proxCodigo = Math.max(0, ...master.map(m => Number(m.codigo) || 0)) + 1;
    const refMaster = doc(collection(db, 'items'));
    const novoMaster: Partial<ItemMaster> = {
      id: refMaster.id,
      codigo: proxCodigo,
      nome: novo.nome.trim(),
      descricao: '',
      unidade: novo.unidade,
      valorUnitario: Number(novo.valorUnitario) || 0,
      categoria: novo.categoria,
      criadoEm: serverTimestamp() as Timestamp,
    };
    await setDoc(refMaster, novoMaster as any);
    const mCompleto = { ...(novoMaster as ItemMaster) };
    setMaster(prev => [...prev, mCompleto]);
    setCriarOpen(false);
    setNovo({ nome: '', unidade: 'unidade', valorUnitario: 0, categoria: 'Material não Esportivo' });
    adicionarDoCatalogo(mCompleto);
  };

  const removerItem = (it: ItemProjeto) => {
    setItens(prev => prev.filter(x => x.id !== it.id));
    setAlloc(prev => { const c = { ...prev }; delete c[it.id]; return c; });
    // se já existia no DB (não tem serverTimestamp pendente? marcamos sempre — delete é idempotente)
    setRemovidos(prev => [...prev, it.id]);
  };

  const salvar = async () => {
    if (!id) return;
    setSaving(true);
    try {
      const batch = writeBatch(db);

      // 1) Remove itens excluídos + seu cronograma
      for (const rid of removidos) {
        batch.delete(doc(db, `projects/${id}/items`, rid));
      }

      // 2) Upsert dos itens (quantidade = soma dos meses, valorTotal)
      for (const it of itens) {
        const qtd = totalItem(it.id);
        const payload: Partial<ItemProjeto> = {
          ...it,
          quantidade: qtd,
          valorTotal: round2(qtd * (it.valorUnitario || 0)),
        };
        batch.set(doc(db, `projects/${id}/items`, it.id), payload as any, { merge: true });
      }

      // 3) Reescreve o cronograma inteiro (apaga e reinsere qty>0)
      const cronAntigo = await getDocs(collection(db, `projects/${id}/cronograma`));
      cronAntigo.docs.forEach(d => batch.delete(d.ref));
      for (const it of itens) {
        const a = alloc[it.id] || {};
        for (const [mesStr, q] of Object.entries(a)) {
          if (q > 0) {
            const ref = doc(collection(db, `projects/${id}/cronograma`));
            const ci: Partial<CronogramaItem> = {
              id: ref.id, projectId: id, itemProjetoId: it.id,
              mes: parseInt(mesStr), quantidade: q, valorTotal: round2(q * (it.valorUnitario || 0)),
              criadoEm: serverTimestamp() as any,
            };
            batch.set(ref, ci as any);
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

  if (loading) return <div className="p-6 flex items-center gap-2 text-lie-gray"><Loader2 className="w-5 h-5 animate-spin" /> Carregando…</div>;

  return (
    <div className="p-6 max-w-[1400px] mx-auto pb-32">
      {id && <ProjetoWorkspaceNav projetoId={id} active="itens" status={projeto?.status} />}

      <header className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-lie-ink">Itens, Orçamento & Cronograma</h1>
          <p className="text-sm text-lie-gray">Adicione os itens e distribua as quantidades pelos meses de execução.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { setPickerOpen(true); setCriarOpen(false); }} className="flex items-center gap-2 bg-lie-green hover:bg-lie-greenDark text-white px-4 py-2 rounded-lg font-bold shadow-sm">
            <Plus className="w-4 h-4" /> Adicionar item
          </button>
        </div>
      </header>

      {/* Picker do catálogo / criar inline */}
      {pickerOpen && (
        <div className="mb-4 border-2 border-lie-green/30 rounded-xl bg-white shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 bg-lie-green/5 border-b border-gray-100">
            <span className="text-sm font-bold text-lie-ink">Adicionar item ao projeto</span>
            <button onClick={() => { setPickerOpen(false); setCriarOpen(false); }} className="text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
          </div>

          {!criarOpen ? (
            <div className="p-3">
              <div className="flex items-center gap-2 mb-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input autoFocus value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar item no catálogo por nome, código ou categoria…" className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <button onClick={() => setCriarOpen(true)} className="flex items-center gap-1.5 text-sm font-bold text-violet-700 bg-violet-50 border border-violet-200 px-3 py-2 rounded-lg hover:bg-violet-100 whitespace-nowrap">
                  <Sparkles className="w-4 h-4" /> Criar item novo
                </button>
              </div>
              <div className="max-h-64 overflow-y-auto divide-y divide-gray-100 border border-gray-100 rounded-lg">
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
                {masterFiltrado.length === 0 && <div className="p-4 text-center text-xs text-gray-400">Nenhum item no catálogo bate com a busca. Use "Criar item novo".</div>}
              </div>
            </div>
          ) : (
            <div className="p-3 grid sm:grid-cols-12 gap-2 items-end">
              <div className="sm:col-span-5">
                <label className="block text-[11px] font-bold text-gray-600 mb-1">Nome do item *</label>
                <input autoFocus value={novo.nome} onChange={e => setNovo(p => ({ ...p, nome: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-2.5 py-2 text-sm" placeholder="Ex: Locação de tenda 3x3" />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-bold text-gray-600 mb-1">Unidade</label>
                <input value={novo.unidade} onChange={e => setNovo(p => ({ ...p, unidade: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-2.5 py-2 text-sm" />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-bold text-gray-600 mb-1">Valor unit. (R$)</label>
                <input type="number" step="0.01" value={novo.valorUnitario} onChange={e => setNovo(p => ({ ...p, valorUnitario: parseFloat(e.target.value) || 0 }))} className="w-full border border-gray-300 rounded-lg px-2.5 py-2 text-sm" />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-bold text-gray-600 mb-1">Categoria</label>
                <select value={novo.categoria} onChange={e => setNovo(p => ({ ...p, categoria: e.target.value as CategoriaItem }))} className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm">
                  {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="sm:col-span-1">
                <button onClick={criarItemInline} className="w-full bg-violet-600 hover:bg-violet-700 text-white rounded-lg py-2 text-sm font-bold">Criar</button>
              </div>
              <div className="sm:col-span-12 text-[11px] text-gray-400">O item criado entra no catálogo geral (reutilizável) e já é adicionado ao projeto.</div>
            </div>
          )}
        </div>
      )}

      {/* Grade itens × meses */}
      {itens.length === 0 ? (
        <div className="bg-white border border-dashed border-gray-300 rounded-xl p-10 text-center text-gray-400">
          <Package className="w-10 h-10 mx-auto mb-2 text-gray-300" />
          Nenhum item ainda. Clique em <strong>Adicionar item</strong> para começar.
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50 text-[11px] uppercase tracking-wider text-gray-500">
                  <th className="text-left px-3 py-2 sticky left-0 bg-gray-50 z-10 min-w-[220px]">Item</th>
                  <th className="text-right px-2 py-2 whitespace-nowrap">Valor unit.</th>
                  {meses.map(m => (
                    <th key={m} className="px-1 py-2 text-center min-w-[60px]" title={`Mês ${m}`}>{rotuloMes(m, projeto?.mesInicio)}</th>
                  ))}
                  <th className="text-right px-2 py-2 whitespace-nowrap">Qtd total</th>
                  <th className="text-right px-2 py-2 whitespace-nowrap">Total R$</th>
                  <th className="px-1 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {itens.map(it => (
                  <tr key={it.id} className="hover:bg-gray-50/50">
                    <td className="px-3 py-2 sticky left-0 bg-white z-10">
                      <div className="font-semibold text-lie-ink leading-tight">{it.nome}</div>
                      <div className="text-[11px] text-gray-400">{it.unidade}{it.codigoCatmat ? ` · CATMAT ${it.codigoCatmat}` : ''}</div>
                    </td>
                    <td className="px-2 py-2 text-right text-gray-600 whitespace-nowrap font-mono text-[12px]">{FMT(it.valorUnitario || 0)}</td>
                    {meses.map(m => (
                      <td key={m} className="px-0.5 py-1">
                        <input
                          type="number" min={0} step="0.01"
                          value={alloc[it.id]?.[m] || ''}
                          onChange={e => setCelula(it.id, m, e.target.value)}
                          className="w-[58px] text-center border border-gray-200 rounded px-1 py-1 text-[12px] focus:border-lie-green focus:ring-1 focus:ring-lie-green/30"
                          placeholder="0"
                        />
                      </td>
                    ))}
                    <td className="px-2 py-2 text-right font-bold text-lie-ink whitespace-nowrap">{totalItem(it.id) || 0}</td>
                    <td className="px-2 py-2 text-right font-bold text-lie-green whitespace-nowrap font-mono text-[12px]">{FMT(valorItem(it))}</td>
                    <td className="px-1 py-2 text-center">
                      <button onClick={() => removerItem(it)} className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded" title="Remover do projeto"><Trash2 className="w-4 h-4" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-lie-green/5 font-bold text-lie-ink">
                  <td className="px-3 py-2.5 sticky left-0 bg-lie-green/5 z-10">Total do projeto</td>
                  <td></td>
                  <td colSpan={meses.length}></td>
                  <td></td>
                  <td className="px-2 py-2.5 text-right text-lie-green font-mono whitespace-nowrap">{FMT(totalProjeto)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Barra de salvar fixa */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-6 py-3 flex items-center justify-between shadow-lg z-20">
        <div className="text-sm text-lie-gray">
          {itens.length} {itens.length === 1 ? 'item' : 'itens'} · total <strong className="text-lie-ink">{FMT(totalProjeto)}</strong>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(`/projetos/${id}`)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium">Voltar à visão geral</button>
          <button onClick={salvar} disabled={saving} className="flex items-center gap-2 bg-lie-green hover:bg-lie-greenDark disabled:opacity-50 text-white px-6 py-2 rounded-lg font-bold shadow-sm">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}
