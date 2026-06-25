/**
 * pages/ProjetoExecucaoPage.tsx
 *
 * Execução do projeto. Reaproveita o cronograma (planejado), agrupado por ETAPA,
 * e registra o REALIZADO. Modelo:
 *  - cada item pode ter VÁRIAS execuções no mesmo mês (entregas parciais);
 *  - cada execução: quantidade, fornecedor (pré-cadastro) e documentos fiscais
 *    (Nota Fiscal · Certidões/Docs Fiscais · Comprovante de Pagamento);
 *  - o SALDO (previsto − realizado) é acumulado e rola para a próxima execução.
 * (Replanejamento 2026-06.)
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  collection, query, getDocs, getDoc, doc, setDoc, deleteDoc, serverTimestamp, orderBy,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import {
  Loader2, Package, Upload, FileCheck2, Plus, Trash2, ChevronLeft, ChevronRight, Building2, Layers,
} from 'lucide-react';
import { db, storage } from '../lib/firebase';
import type { Projeto, ItemProjeto, CronogramaItem, Fornecedor, EtapaProjeto } from '../types';
import ProjetoWorkspaceNav from '../components/ProjetoWorkspaceNav';

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

interface Execucao {
  id: string;
  itemProjetoId: string;
  mes: number;
  quantidade: number;
  fornecedorId: string;
  notaFiscalUrl: string;
  certidoesUrl: string;
  pagamentoUrl: string;
}

const FORM_VAZIO = { quantidade: 0, fornecedorId: '', notaFiscalUrl: '', certidoesUrl: '', pagamentoUrl: '' };

export default function ProjetoExecucaoPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [projeto, setProjeto] = useState<Projeto | null>(null);
  const [itens, setItens] = useState<ItemProjeto[]>([]);
  const [etapas, setEtapas] = useState<EtapaProjeto[]>([]);
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [previsto, setPrevisto] = useState<Record<string, Record<number, number>>>({});
  const [execucoes, setExecucoes] = useState<Execucao[]>([]);
  const [mesAtivo, setMesAtivo] = useState(1);

  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [form, setForm] = useState({ ...FORM_VAZIO });
  const [uploadField, setUploadField] = useState<string | null>(null);
  const [salvandoExec, setSalvandoExec] = useState(false);

  const duracao = projeto?.duracaoMeses || 12;
  const meses = useMemo(() => Array.from({ length: duracao }, (_, i) => i + 1), [duracao]);

  const carregar = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const projSnap = await getDoc(doc(db, 'projects', id));
      if (projSnap.exists()) { const p = { id: projSnap.id, ...projSnap.data() } as Projeto; setProjeto(p); setEtapas(p.etapas || []); }
      const [itSnap, fSnap, cSnap, eSnap] = await Promise.all([
        getDocs(query(collection(db, `projects/${id}/items`), orderBy('criadoEm', 'asc'))),
        getDocs(query(collection(db, 'suppliers'), orderBy('razaoSocial', 'asc'))),
        getDocs(collection(db, `projects/${id}/cronograma`)),
        getDocs(collection(db, `projects/${id}/execucoes`)),
      ]);
      setItens(itSnap.docs.map(d => ({ id: d.id, ...d.data() } as ItemProjeto)));
      setFornecedores(fSnap.docs.map(d => ({ id: d.id, ...d.data() } as Fornecedor)));
      const prev: Record<string, Record<number, number>> = {};
      cSnap.docs.forEach(d => { const ci = d.data() as CronogramaItem; (prev[ci.itemProjetoId] ||= {})[ci.mes] = ci.quantidade; });
      setPrevisto(prev);
      setExecucoes(eSnap.docs.map(d => ({ id: d.id, ...d.data() } as Execucao)));
    } finally { setLoading(false); }
  };
  useEffect(() => { carregar(); /* eslint-disable-next-line */ }, [id]);

  // ---- cálculos de previsto/realizado/saldo (com rollover) ----
  const prevMes = (iid: string, m: number) => previsto[iid]?.[m] || 0;
  const cumPrev = (iid: string, m: number) => meses.filter(k => k <= m).reduce((s, k) => s + prevMes(iid, k), 0);
  const execsItemMes = (iid: string, m: number) => execucoes.filter(e => e.itemProjetoId === iid && e.mes === m);
  const cumReal = (iid: string, m: number) => execucoes.filter(e => e.itemProjetoId === iid && e.mes <= m).reduce((s, e) => s + (e.quantidade || 0), 0);
  const aExecutar = (iid: string, m: number) => round2(cumPrev(iid, m) - cumReal(iid, m - 1)); // previsto acumulado − já realizado antes
  const realMes = (iid: string, m: number) => round2(execsItemMes(iid, m).reduce((s, e) => s + (e.quantidade || 0), 0));
  const saldoProx = (iid: string, m: number) => round2(aExecutar(iid, m) - realMes(iid, m)); // rola pro próximo

  const fornecedorNome = (fid: string) => { const f = fornecedores.find(x => x.id === fid); return f ? (f.nomeFantasia || f.razaoSocial) : '—'; };

  // itens visíveis no mês: têm o que executar (com saldo) ou já têm execução no mês
  const gruposEtapa: EtapaProjeto[] = [...etapas, ...(itens.some(it => !it.etapaId) ? [{ id: '', nome: 'Sem etapa' } as EtapaProjeto] : [])];
  const itemVisivel = (it: ItemProjeto) => aExecutar(it.id, mesAtivo) > 0 || execsItemMes(it.id, mesAtivo).length > 0;

  const totalPrevMes = round2(itens.reduce((s, it) => s + aExecutar(it.id, mesAtivo) * (it.valorUnitario || 0), 0));
  const totalRealMes = round2(itens.reduce((s, it) => s + realMes(it.id, mesAtivo) * (it.valorUnitario || 0), 0));

  // ---- upload + lançamento ----
  const handleUpload = async (campo: 'notaFiscalUrl' | 'certidoesUrl' | 'pagamentoUrl', file: File) => {
    if (!id || !file || !addingFor) return;
    setUploadField(campo);
    try {
      const ext = file.name.split('.').pop() || 'pdf';
      const tag = campo === 'notaFiscalUrl' ? 'nf' : campo === 'certidoesUrl' ? 'cert' : 'pgto';
      const r = ref(storage, `projects/${id}/execucao/mes_${mesAtivo}/${addingFor}_${tag}_${Date.now()}.${ext}`);
      await uploadBytes(r, file);
      const url = await getDownloadURL(r);
      setForm(f => ({ ...f, [campo]: url }));
    } catch (e: any) { alert('Erro no upload: ' + (e?.message || e)); }
    finally { setUploadField(null); }
  };

  const abrirAdd = (iid: string) => { setAddingFor(iid); setForm({ ...FORM_VAZIO, quantidade: 0 }); };

  const lancar = async (it: ItemProjeto) => {
    if (!id) return;
    if (!form.quantidade || form.quantidade <= 0) { alert('Informe a quantidade executada.'); return; }
    if (!form.fornecedorId) { alert('Selecione o fornecedor.'); return; }
    setSalvandoExec(true);
    try {
      const r = doc(collection(db, `projects/${id}/execucoes`));
      const novo: Execucao = { id: r.id, itemProjetoId: it.id, mes: mesAtivo, quantidade: round2(form.quantidade), fornecedorId: form.fornecedorId, notaFiscalUrl: form.notaFiscalUrl, certidoesUrl: form.certidoesUrl, pagamentoUrl: form.pagamentoUrl };
      await setDoc(r, { ...novo, projectId: id, criadoEm: serverTimestamp() } as any);
      setExecucoes(prev => [...prev, novo]);
      setAddingFor(null);
    } catch (e: any) { alert('Erro ao lançar execução: ' + (e?.message || e)); }
    finally { setSalvandoExec(false); }
  };

  const remover = async (e: Execucao) => {
    if (!id || !window.confirm('Remover esta execução?')) return;
    await deleteDoc(doc(db, `projects/${id}/execucoes`, e.id));
    setExecucoes(prev => prev.filter(x => x.id !== e.id));
  };

  if (loading) return <div className="p-6 flex items-center gap-2 text-lie-gray"><Loader2 className="w-5 h-5 animate-spin" /> Carregando…</div>;

  return (
    <div className="p-6 max-w-5xl mx-auto pb-20">
      {id && <ProjetoWorkspaceNav projetoId={id} active="execucao" status={projeto?.status} />}
      <header className="mb-4">
        <h1 className="text-2xl font-bold text-lie-ink">Execução do Projeto</h1>
        <p className="text-sm text-lie-gray">Registre o realizado por etapa. O saldo (previsto − realizado) rola automaticamente para a próxima execução.</p>
      </header>

      {/* Navegação por mês */}
      <div className="flex items-center gap-1 mb-4 overflow-x-auto pb-1">
        <button onClick={() => setMesAtivo(m => Math.max(1, m - 1))} className="p-1.5 text-gray-400 hover:text-lie-ink shrink-0"><ChevronLeft className="w-4 h-4" /></button>
        {meses.map(m => {
          const n = itens.filter(it => aExecutar(it.id, m) > 0 || execsItemMes(it.id, m).length > 0).length;
          const ativo = m === mesAtivo;
          return (
            <button key={m} onClick={() => { setMesAtivo(m); setAddingFor(null); }} className={`px-3 py-1.5 rounded-lg text-sm font-semibold whitespace-nowrap shrink-0 border transition ${ativo ? 'bg-lie-green text-white border-lie-green' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}>
              {rotuloMes(m, projeto?.mesInicio)}{n > 0 && <span className={`ml-1.5 text-[10px] ${ativo ? 'text-white/80' : 'text-gray-400'}`}>({n})</span>}
            </button>
          );
        })}
        <button onClick={() => setMesAtivo(m => Math.min(duracao, m + 1))} className="p-1.5 text-gray-400 hover:text-lie-ink shrink-0"><ChevronRight className="w-4 h-4" /></button>
      </div>

      {/* Resumo do mês */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-white border border-gray-200 rounded-xl p-3"><div className="text-[11px] uppercase tracking-wider text-gray-500 font-bold">A executar no mês (c/ saldo)</div><div className="text-xl font-bold text-lie-ink font-mono">{FMT(totalPrevMes)}</div></div>
        <div className="bg-white border border-gray-200 rounded-xl p-3"><div className="text-[11px] uppercase tracking-wider text-gray-500 font-bold">Realizado no mês</div><div className="text-xl font-bold text-lie-green font-mono">{FMT(totalRealMes)}</div></div>
      </div>

      {/* Itens agrupados por etapa */}
      {gruposEtapa.every(et => !itens.filter(it => (it.etapaId || '') === et.id).some(itemVisivel)) ? (
        <div className="bg-white border border-dashed border-gray-300 rounded-xl p-10 text-center text-gray-400">
          <Package className="w-10 h-10 mx-auto mb-2 text-gray-300" />
          Nenhum item a executar em <strong>{rotuloMes(mesAtivo, projeto?.mesInicio)}</strong>.
        </div>
      ) : gruposEtapa.map((et, gi) => {
        const itensEt = itens.filter(it => (it.etapaId || '') === et.id && itemVisivel(it));
        if (itensEt.length === 0) return null;
        const prevEt = round2(itensEt.reduce((s, it) => s + aExecutar(it.id, mesAtivo) * (it.valorUnitario || 0), 0));
        return (
          <div key={et.id || 'sem'} className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <Layers className="w-4 h-4 text-lie-green" />
              <h2 className="font-bold text-lie-ink uppercase text-sm tracking-wide">{et.id ? `${gi + 1}.0 — ` : ''}{et.nome}</h2>
              <span className="text-xs text-gray-400">previsto no mês: {FMT(prevEt)}</span>
            </div>
            <div className="space-y-2">
              {itensEt.map(it => {
                const exMes = execsItemMes(it.id, mesAtivo);
                const aExec = aExecutar(it.id, mesAtivo);
                const real = realMes(it.id, mesAtivo);
                const saldo = saldoProx(it.id, mesAtivo);
                return (
                  <div key={it.id} className="bg-white border border-gray-200 rounded-xl p-3">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="min-w-0">
                        <div className="font-bold text-lie-ink">{it.nome}</div>
                        <div className="text-[11px] text-gray-400">{it.categoria || ''} · {it.unidade} · {FMT(it.valorUnitario || 0)}/un</div>
                      </div>
                      <div className="flex items-center gap-3 text-xs">
                        <span className="text-gray-500">Previsto mês: <strong className="text-lie-ink">{prevMes(it.id, mesAtivo)}</strong></span>
                        <span className="text-gray-500">A executar: <strong className="text-lie-ink">{aExec}</strong></span>
                        <span className="text-gray-500">Realizado: <strong className="text-lie-green">{real}</strong></span>
                        <span className={`font-bold ${saldo > 0 ? 'text-amber-600' : 'text-emerald-600'}`} title="Diferença que rola para a próxima execução">Saldo → próx.: {saldo}</span>
                      </div>
                    </div>

                    {/* Execuções já lançadas neste mês */}
                    {exMes.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {exMes.map(e => (
                          <div key={e.id} className="flex items-center gap-2 text-xs bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-1.5">
                            <span className="font-bold text-lie-ink">{e.quantidade} {it.unidade}</span>
                            <span className="flex items-center gap-1 text-gray-600"><Building2 className="w-3 h-3" /> {fornecedorNome(e.fornecedorId)}</span>
                            <span className="flex items-center gap-1.5 ml-auto">
                              <DocTag url={e.notaFiscalUrl} sigla="NF" />
                              <DocTag url={e.certidoesUrl} sigla="Cert." />
                              <DocTag url={e.pagamentoUrl} sigla="Pgto" />
                              <button onClick={() => remover(e)} className="text-red-400 hover:text-red-600 ml-1" title="Remover"><Trash2 className="w-3.5 h-3.5" /></button>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Form de nova execução */}
                    {addingFor === it.id ? (
                      <div className="mt-2 border border-lie-green/30 rounded-lg p-2.5 bg-lie-green/5">
                        <div className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
                          <div>
                            <label className="block text-[10px] font-bold text-gray-600 mb-1">Qtd executada</label>
                            <input type="number" min={0} step="0.01" autoFocus value={form.quantidade || ''} onChange={e => setForm(f => ({ ...f, quantidade: parseFloat(e.target.value) || 0 }))} placeholder={String(aExec)} className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-gray-600 mb-1">Fornecedor</label>
                            <select value={form.fornecedorId} onChange={e => setForm(f => ({ ...f, fornecedorId: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-1.5 py-1.5 text-sm">
                              <option value="">Selecione…</option>
                              {fornecedores.map(f => <option key={f.id} value={f.id}>{f.nomeFantasia || f.razaoSocial}</option>)}
                            </select>
                          </div>
                          <UploadMini label="Nota Fiscal" url={form.notaFiscalUrl} busy={uploadField === 'notaFiscalUrl'} onFile={f => handleUpload('notaFiscalUrl', f)} />
                          <UploadMini label="Certidões" url={form.certidoesUrl} busy={uploadField === 'certidoesUrl'} onFile={f => handleUpload('certidoesUrl', f)} />
                          <UploadMini label="Comprov. Pagto" url={form.pagamentoUrl} busy={uploadField === 'pagamentoUrl'} onFile={f => handleUpload('pagamentoUrl', f)} />
                        </div>
                        <div className="flex justify-end gap-2 mt-2">
                          <button onClick={() => setAddingFor(null)} className="px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100 rounded-lg">Cancelar</button>
                          <button onClick={() => lancar(it)} disabled={salvandoExec} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-lie-green hover:bg-lie-greenDark text-white rounded-lg disabled:opacity-50">
                            {salvandoExec ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Lançar execução
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button onClick={() => abrirAdd(it.id)} className="mt-2 flex items-center gap-1 text-xs font-bold text-lie-green hover:underline"><Plus className="w-3.5 h-3.5" /> Adicionar execução</button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DocTag({ url, sigla }: { url: string; sigla: string }) {
  if (!url) return <span className="text-[10px] text-gray-300 border border-gray-200 rounded px-1">{sigla}</span>;
  return <a href={url} target="_blank" rel="noopener noreferrer" className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1 inline-flex items-center gap-0.5 hover:bg-emerald-100"><FileCheck2 className="w-3 h-3" />{sigla}</a>;
}

function UploadMini({ label, url, busy, onFile }: { label: string; url: string; busy: boolean; onFile: (f: File) => void }) {
  return (
    <div>
      <label className="block text-[10px] font-bold text-gray-600 mb-1">{label}</label>
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg px-2 py-1.5 text-xs font-semibold hover:bg-emerald-100"><FileCheck2 className="w-3.5 h-3.5" /> anexado</a>
      ) : (
        <label className="flex items-center gap-1 bg-white border border-gray-300 text-gray-600 rounded-lg px-2 py-1.5 text-xs font-semibold cursor-pointer hover:bg-gray-50">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} {busy ? '…' : 'Anexar'}
          <input type="file" className="hidden" disabled={busy} onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} />
        </label>
      )}
    </div>
  );
}
