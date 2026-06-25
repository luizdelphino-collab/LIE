/**
 * pages/ProjetoExecucaoPage.tsx
 *
 * Execução do projeto — reaproveita a grade do cronograma (planejado) e registra
 * o REALIZADO mês a mês: quantidade executada, fornecedor e comprovantes
 * (nota fiscal + comprovante de pagamento). Mostra previsto vs realizado.
 * Alimenta a futura prestação de contas. (Replanejamento 2026-06.)
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  collection, query, getDocs, getDoc, doc, setDoc, serverTimestamp, orderBy,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import {
  Loader2, Save, Package, Upload, FileCheck2, CheckCircle2, Circle, Building2, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { db, storage } from '../lib/firebase';
import type { Projeto, ItemProjeto, CronogramaItem, Fornecedor } from '../types';
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

interface ExecRecord {
  itemProjetoId: string;
  mes: number;
  quantidadeRealizada: number;
  fornecedorId: string;
  notaFiscalUrl: string;
  pagamentoUrl: string;
}

export default function ProjetoExecucaoPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [projeto, setProjeto] = useState<Projeto | null>(null);
  const [itens, setItens] = useState<ItemProjeto[]>([]);
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [previsto, setPrevisto] = useState<Record<string, Record<number, number>>>({}); // [itemId][mes]=qtd
  const [exec, setExec] = useState<Record<string, ExecRecord>>({}); // key `${itemId}_${mes}`
  const [uploading, setUploading] = useState<Set<string>>(new Set());
  const [mesAtivo, setMesAtivo] = useState(1);

  const duracao = projeto?.duracaoMeses || 12;
  const meses = useMemo(() => Array.from({ length: duracao }, (_, i) => i + 1), [duracao]);

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      try {
        const projSnap = await getDoc(doc(db, 'projects', id));
        if (projSnap.exists()) setProjeto({ id: projSnap.id, ...projSnap.data() } as Projeto);
        const [itSnap, fSnap, cSnap, eSnap] = await Promise.all([
          getDocs(query(collection(db, `projects/${id}/items`), orderBy('criadoEm', 'asc'))),
          getDocs(query(collection(db, 'suppliers'), orderBy('razaoSocial', 'asc'))),
          getDocs(collection(db, `projects/${id}/cronograma`)),
          getDocs(collection(db, `projects/${id}/execucoes`)),
        ]);
        setItens(itSnap.docs.map(d => ({ id: d.id, ...d.data() } as ItemProjeto)));
        setFornecedores(fSnap.docs.map(d => ({ id: d.id, ...d.data() } as Fornecedor)));
        const prev: Record<string, Record<number, number>> = {};
        cSnap.docs.forEach(d => {
          const ci = d.data() as CronogramaItem;
          if (!prev[ci.itemProjetoId]) prev[ci.itemProjetoId] = {};
          prev[ci.itemProjetoId][ci.mes] = ci.quantidade;
        });
        setPrevisto(prev);
        const ex: Record<string, ExecRecord> = {};
        eSnap.docs.forEach(d => { const r = d.data() as ExecRecord; ex[`${r.itemProjetoId}_${r.mes}`] = r; });
        setExec(ex);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const itemById = (iid: string) => itens.find(i => i.id === iid);
  const getExec = (iid: string, mes: number): ExecRecord =>
    exec[`${iid}_${mes}`] || { itemProjetoId: iid, mes, quantidadeRealizada: 0, fornecedorId: '', notaFiscalUrl: '', pagamentoUrl: '' };
  const setExecCampo = (iid: string, mes: number, patch: Partial<ExecRecord>) =>
    setExec(prev => ({ ...prev, [`${iid}_${mes}`]: { ...getExec(iid, mes), ...patch } }));

  // Itens previstos no mês ativo
  const itensDoMes = itens
    .filter(it => (previsto[it.id]?.[mesAtivo] || 0) > 0)
    .sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));

  const totalPrevistoMes = round2(itensDoMes.reduce((s, it) => s + (previsto[it.id][mesAtivo] * (it.valorUnitario || 0)), 0));
  const totalRealizadoMes = round2(itensDoMes.reduce((s, it) => s + (getExec(it.id, mesAtivo).quantidadeRealizada * (it.valorUnitario || 0)), 0));

  const statusItem = (iid: string, mes: number): 'completo' | 'parcial' | 'pendente' => {
    const e = getExec(iid, mes);
    if (e.quantidadeRealizada > 0 && e.fornecedorId && e.notaFiscalUrl && e.pagamentoUrl) return 'completo';
    if (e.quantidadeRealizada > 0 || e.fornecedorId || e.notaFiscalUrl || e.pagamentoUrl) return 'parcial';
    return 'pendente';
  };

  const handleUpload = async (iid: string, mes: number, campo: 'notaFiscalUrl' | 'pagamentoUrl', file: File) => {
    if (!id || !file) return;
    const key = `${iid}_${mes}_${campo}`;
    setUploading(prev => new Set(prev).add(key));
    try {
      const ext = file.name.split('.').pop() || 'pdf';
      const path = `projects/${id}/execucao/mes_${mes}/${iid}_${campo === 'notaFiscalUrl' ? 'nf' : 'pgto'}_${Date.now()}.${ext}`;
      const r = ref(storage, path);
      await uploadBytes(r, file);
      const url = await getDownloadURL(r);
      setExecCampo(iid, mes, { [campo]: url } as Partial<ExecRecord>);
    } catch (e: any) {
      alert('Erro ao enviar arquivo: ' + (e?.message || e));
    } finally {
      setUploading(prev => { const s = new Set(prev); s.delete(key); return s; });
    }
  };

  const salvar = async () => {
    if (!id) return;
    setSaving(true);
    try {
      // Grava todos os registros de execução com algum dado preenchido.
      const registros = Object.values(exec).filter(e =>
        e.quantidadeRealizada > 0 || e.fornecedorId || e.notaFiscalUrl || e.pagamentoUrl);
      for (const e of registros) {
        await setDoc(doc(db, `projects/${id}/execucoes`, `${e.itemProjetoId}_${e.mes}`), {
          ...e, projectId: id, atualizadoEm: serverTimestamp(),
        } as any, { merge: true });
      }
      alert('Execução salva com sucesso!');
    } catch (e: any) {
      console.error(e);
      alert('Erro ao salvar execução: ' + (e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-6 flex items-center gap-2 text-lie-gray"><Loader2 className="w-5 h-5 animate-spin" /> Carregando…</div>;

  return (
    <div className="p-6 max-w-6xl mx-auto pb-32">
      {id && <ProjetoWorkspaceNav projetoId={id} active="execucao" status={projeto?.status} />}

      <header className="mb-4">
        <h1 className="text-2xl font-bold text-lie-ink">Execução do Projeto</h1>
        <p className="text-sm text-lie-gray">Registre o que foi realizado mês a mês — quantidade, fornecedor e comprovantes (NF + pagamento).</p>
      </header>

      {/* Navegação por mês */}
      <div className="flex items-center gap-1 mb-4 overflow-x-auto pb-1">
        <button onClick={() => setMesAtivo(m => Math.max(1, m - 1))} className="p-1.5 text-gray-400 hover:text-lie-ink shrink-0"><ChevronLeft className="w-4 h-4" /></button>
        {meses.map(m => {
          const previstosNoMes = itens.filter(it => (previsto[it.id]?.[m] || 0) > 0).length;
          const ativo = m === mesAtivo;
          return (
            <button key={m} onClick={() => setMesAtivo(m)}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold whitespace-nowrap shrink-0 border transition ${ativo ? 'bg-lie-green text-white border-lie-green' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}>
              {rotuloMes(m, projeto?.mesInicio)}
              {previstosNoMes > 0 && <span className={`ml-1.5 text-[10px] ${ativo ? 'text-white/80' : 'text-gray-400'}`}>({previstosNoMes})</span>}
            </button>
          );
        })}
        <button onClick={() => setMesAtivo(m => Math.min(duracao, m + 1))} className="p-1.5 text-gray-400 hover:text-lie-ink shrink-0"><ChevronRight className="w-4 h-4" /></button>
      </div>

      {/* Resumo do mês */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-white border border-gray-200 rounded-xl p-3">
          <div className="text-[11px] uppercase tracking-wider text-gray-500 font-bold">Previsto no mês</div>
          <div className="text-xl font-bold text-lie-ink font-mono">{FMT(totalPrevistoMes)}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-3">
          <div className="text-[11px] uppercase tracking-wider text-gray-500 font-bold">Realizado no mês</div>
          <div className="text-xl font-bold text-lie-green font-mono">{FMT(totalRealizadoMes)}</div>
        </div>
      </div>

      {/* Lista de itens previstos no mês */}
      {itensDoMes.length === 0 ? (
        <div className="bg-white border border-dashed border-gray-300 rounded-xl p-10 text-center text-gray-400">
          <Package className="w-10 h-10 mx-auto mb-2 text-gray-300" />
          Nenhum item previsto em <strong>{rotuloMes(mesAtivo, projeto?.mesInicio)}</strong>. Defina o cronograma na aba Itens & Orçamento.
        </div>
      ) : (
        <div className="space-y-2">
          {itensDoMes.map(it => {
            const prevQty = previsto[it.id][mesAtivo];
            const e = getExec(it.id, mesAtivo);
            const st = statusItem(it.id, mesAtivo);
            const nfKey = `${it.id}_${mesAtivo}_notaFiscalUrl`;
            const pgKey = `${it.id}_${mesAtivo}_pagamentoUrl`;
            return (
              <div key={it.id} className="bg-white border border-gray-200 rounded-xl p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {st === 'completo' ? <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" /> : st === 'parcial' ? <Circle className="w-5 h-5 text-amber-400 shrink-0" /> : <Circle className="w-5 h-5 text-gray-200 shrink-0" />}
                    <div className="min-w-0">
                      <div className="font-bold text-lie-ink truncate">{it.nome}</div>
                      <div className="text-[11px] text-gray-400">{it.categoria || ''} · {it.unidade} · {FMT(it.valorUnitario || 0)}/un</div>
                    </div>
                  </div>
                  <div className="text-right text-xs text-gray-500 shrink-0">
                    Previsto: <strong className="text-lie-ink">{prevQty}</strong> {it.unidade} · {FMT(prevQty * (it.valorUnitario || 0))}
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end">
                  <div>
                    <label className="block text-[11px] font-bold text-gray-600 mb-1">Realizado ({it.unidade})</label>
                    <input type="number" min={0} step="0.01" value={e.quantidadeRealizada || ''} onChange={ev => setExecCampo(it.id, mesAtivo, { quantidadeRealizada: round2(parseFloat(ev.target.value) || 0) })}
                      placeholder={String(prevQty)} className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-gray-600 mb-1">Fornecedor</label>
                    <select value={e.fornecedorId} onChange={ev => setExecCampo(it.id, mesAtivo, { fornecedorId: ev.target.value })} className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm">
                      <option value="">Selecione…</option>
                      {fornecedores.map(f => <option key={f.id} value={f.id}>{f.nomeFantasia || f.razaoSocial}</option>)}
                    </select>
                  </div>
                  <ComprovanteBtn label="Nota Fiscal" url={e.notaFiscalUrl} uploading={uploading.has(nfKey)} onFile={f => handleUpload(it.id, mesAtivo, 'notaFiscalUrl', f)} />
                  <ComprovanteBtn label="Comprov. Pagamento" url={e.pagamentoUrl} uploading={uploading.has(pgKey)} onFile={f => handleUpload(it.id, mesAtivo, 'pagamentoUrl', f)} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Barra fixa */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-6 py-3 flex items-center justify-between shadow-lg z-20">
        <div className="text-sm text-lie-gray">{rotuloMes(mesAtivo, projeto?.mesInicio)} · realizado <strong className="text-lie-ink">{FMT(totalRealizadoMes)}</strong> de {FMT(totalPrevistoMes)}</div>
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(`/projetos/${id}`)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium">Visão geral</button>
          <button onClick={salvar} disabled={saving} className="flex items-center gap-2 bg-lie-green hover:bg-lie-greenDark disabled:opacity-50 text-white px-6 py-2 rounded-lg font-bold shadow-sm">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}{saving ? 'Salvando…' : 'Salvar execução'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ComprovanteBtn({ label, url, uploading, onFile }: { label: string; url: string; uploading: boolean; onFile: (f: File) => void }) {
  return (
    <div>
      <label className="block text-[11px] font-bold text-gray-600 mb-1">{label}</label>
      {url ? (
        <div className="flex items-center gap-1">
          <a href={url} target="_blank" rel="noopener noreferrer" className="flex-1 flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg px-2.5 py-1.5 text-sm font-semibold hover:bg-emerald-100">
            <FileCheck2 className="w-4 h-4" /> anexado
          </a>
          <label className="cursor-pointer text-[11px] text-gray-400 hover:text-lie-ink px-1" title="Substituir">
            trocar
            <input type="file" className="hidden" onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} />
          </label>
        </div>
      ) : (
        <label className="flex items-center gap-1.5 bg-white border border-gray-300 text-gray-600 rounded-lg px-2.5 py-1.5 text-sm font-semibold cursor-pointer hover:bg-gray-50">
          {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} {uploading ? 'Enviando…' : 'Anexar'}
          <input type="file" className="hidden" disabled={uploading} onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} />
        </label>
      )}
    </div>
  );
}
