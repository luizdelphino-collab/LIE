import { useEffect, useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  doc, getDoc, setDoc, serverTimestamp, collection, getDocs, deleteDoc, Timestamp
} from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import {
  ArrowLeft, Save, Award, BookOpen, Loader2, CheckCircle2, Plus, FileText,
  Trash2, Eye, Upload, X, AlertCircle
} from 'lucide-react';
import { db, storage } from '../lib/firebase';
import type { Entidade } from '../types';

interface CapacidadeDocumento {
  id: string;
  nome: string;
  arquivoUrl: string;
  arquivoNome?: string;
  tamanho?: number;
  criadoEm?: Timestamp;
  // Campos legados — exibidos se existirem
  tipo?: string;
  ano?: number;
  orgaoEmitente?: string;
}

interface UploadItem {
  id: string;
  file: File;
  progress: number;
  status: 'pending' | 'uploading' | 'done' | 'error';
  error?: string;
}

const MAX_FILE_MB = 20;
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (!bytes) return '-';
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function formatDate(ts?: Timestamp): string {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts as any);
  return d.toLocaleDateString('pt-BR');
}

export default function CapacidadeTecnicaPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [entidade, setEntidade] = useState<Entidade | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingTexto, setSavingTexto] = useState(false);
  const [savedTextoAt, setSavedTextoAt] = useState<Date | null>(null);

  const [historico, setHistorico] = useState('');
  const [capacidadeTecnica, setCapacidadeTecnica] = useState('');

  const [documentos, setDocumentos] = useState<CapacidadeDocumento[]>([]);

  // Upload em lote
  const [uploadQueue, setUploadQueue] = useState<UploadItem[]>([]);
  const [uploadingBatch, setUploadingBatch] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const carregarTudo = async () => {
    if (!id) return;
    try {
      setLoading(true);
      const snap = await getDoc(doc(db, 'entities', id));
      if (snap.exists()) {
        const ent = { id: snap.id, ...snap.data() } as Entidade;
        setEntidade(ent);
        setHistorico((ent as any).historico || '');
        setCapacidadeTecnica((ent as any).capacidadeTecnica || '');
      }
      await carregarDocumentos();
    } catch (err) {
      console.error('Erro ao carregar entidade:', err);
    } finally {
      setLoading(false);
    }
  };

  const carregarDocumentos = async () => {
    if (!id) return;
    const snap = await getDocs(collection(db, `entities/${id}/capacidadeDocumentos`));
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as CapacidadeDocumento));
    list.sort((a, b) => {
      const ta = a.criadoEm?.toDate?.().getTime?.() || 0;
      const tb = b.criadoEm?.toDate?.().getTime?.() || 0;
      return tb - ta;
    });
    setDocumentos(list);
  };

  useEffect(() => { carregarTudo(); }, [id]);

  const handleSalvarTextos = async () => {
    if (!id) return;
    setSavingTexto(true);
    try {
      await setDoc(doc(db, 'entities', id), {
        historico, capacidadeTecnica, atualizadoEm: serverTimestamp()
      }, { merge: true });
      setSavedTextoAt(new Date());
    } catch (err: any) {
      alert(`Erro ao salvar textos: ${err?.message || err}`);
    } finally {
      setSavingTexto(false);
    }
  };

  const handlePickFiles = () => {
    fileInputRef.current?.click();
  };

  const handleFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const rejected: string[] = [];
    const accepted: UploadItem[] = [];

    for (const f of files) {
      if (f.size > MAX_FILE_BYTES) {
        rejected.push(`${f.name} (${formatBytes(f.size)})`);
        continue;
      }
      accepted.push({
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        file: f,
        progress: 0,
        status: 'pending'
      });
    }

    if (rejected.length > 0) {
      alert(`Os seguintes arquivos excedem ${MAX_FILE_MB}MB e foram ignorados:\n\n${rejected.join('\n')}`);
    }

    if (accepted.length > 0) {
      setUploadQueue(accepted);
      // Start upload imediatamente
      iniciarUploads(accepted);
    }

    // Limpa input pra permitir selecionar os mesmos arquivos de novo se quiser
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const iniciarUploads = async (items: UploadItem[]) => {
    if (!id) return;
    setUploadingBatch(true);

    // Upload paralelo de até 3 simultâneos pra não estourar nem ficar lento
    const CONCURRENT = 3;
    let cursor = 0;

    const updateItem = (itemId: string, patch: Partial<UploadItem>) => {
      setUploadQueue(prev => prev.map(it => it.id === itemId ? { ...it, ...patch } : it));
    };

    const uploadOne = async (item: UploadItem): Promise<void> => {
      updateItem(item.id, { status: 'uploading', progress: 0 });
      try {
        const docId = doc(collection(db, `entities/${id}/capacidadeDocumentos`)).id;
        const ext = item.file.name.split('.').pop() || 'pdf';
        const path = `entities/${id}/capacidade_tecnica/${docId}_${Date.now()}.${ext}`;
        const fileRef = ref(storage, path);
        const task = uploadBytesResumable(fileRef, item.file);

        await new Promise<void>((resolve, reject) => {
          task.on('state_changed',
            (s) => {
              const pct = (s.bytesTransferred / s.totalBytes) * 100;
              updateItem(item.id, { progress: pct });
            },
            (err) => reject(err),
            async () => {
              try {
                const url = await getDownloadURL(task.snapshot.ref);
                await setDoc(doc(db, `entities/${id}/capacidadeDocumentos`, docId), {
                  id: docId,
                  nome: item.file.name.replace(/\.[^.]+$/, ''),
                  arquivoUrl: url,
                  arquivoNome: item.file.name,
                  tamanho: item.file.size,
                  criadoEm: serverTimestamp()
                });
                updateItem(item.id, { status: 'done', progress: 100 });
                resolve();
              } catch (e) {
                reject(e);
              }
            }
          );
        });
      } catch (err: any) {
        console.error('Erro no upload:', item.file.name, err);
        updateItem(item.id, { status: 'error', error: err?.message || 'Falha' });
      }
    };

    const runners: Promise<void>[] = [];
    const runNext = async (): Promise<void> => {
      while (cursor < items.length) {
        const i = cursor++;
        await uploadOne(items[i]);
      }
    };
    for (let k = 0; k < Math.min(CONCURRENT, items.length); k++) {
      runners.push(runNext());
    }
    await Promise.all(runners);

    setUploadingBatch(false);
    await carregarDocumentos();
  };

  const limparQueue = () => {
    setUploadQueue([]);
  };

  const handleExcluirDoc = async (d: CapacidadeDocumento) => {
    if (!id) return;
    if (!confirm(`Excluir o documento "${d.nome}"? Esta ação não pode ser desfeita.`)) return;
    try {
      await deleteDoc(doc(db, `entities/${id}/capacidadeDocumentos`, d.id));
      setDocumentos(prev => prev.filter(x => x.id !== d.id));
    } catch (err: any) {
      alert(`Erro ao excluir: ${err?.message || err}`);
    }
  };

  if (loading) return <div className="p-6 text-lie-gray">Carregando…</div>;
  if (!entidade) {
    return (
      <div className="p-6 text-center text-lie-gray">
        Entidade não encontrada.
        <button onClick={() => navigate('/entidades')} className="ml-2 text-lie-green underline">Voltar</button>
      </div>
    );
  }

  const totalProgress = uploadQueue.length === 0
    ? 0
    : uploadQueue.reduce((acc, it) => acc + it.progress, 0) / uploadQueue.length;
  const concluidos = uploadQueue.filter(it => it.status === 'done').length;
  const comErro = uploadQueue.filter(it => it.status === 'error').length;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/entidades')} className="p-2 text-lie-gray hover:bg-gray-100 rounded-lg transition">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-lie-ink flex items-center gap-2">
              <Award className="w-6 h-6 text-amber-600" />
              Capacidade Técnica e Operacional
            </h1>
            <p className="text-sm text-lie-gray">
              {entidade.nome}
              {entidade.sigla && <span className="ml-1 text-gray-400">({entidade.sigla})</span>}
            </p>
          </div>
        </div>
      </header>

      <div className="bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 rounded-xl p-4 mb-6 text-sm text-amber-900 leading-relaxed">
        <p>
          <strong>Por que cadastrar isso?</strong> Os textos e os <strong>documentos comprobatórios</strong>
          (portfólios, atestados de capacidade técnica emitidos por governos, contratos em vigência, etc.)
          são impressos como uma seção dedicada do consolidado do projeto, comprovando ao parecerista
          a experiência institucional e a capacidade da entidade pra executar o projeto.
        </p>
      </div>

      {/* ===== TEXTOS ===== */}
      <div className="space-y-6 mb-8">
        <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
          <label className="flex items-center gap-2 text-base font-bold text-lie-ink mb-1">
            <BookOpen className="w-5 h-5 text-lie-green" />
            Histórico Institucional
          </label>
          <p className="text-xs text-gray-500 mb-3">
            Trajetória da entidade: fundação, missão, valores, principais marcos, áreas de atuação.
          </p>
          <textarea
            value={historico}
            onChange={(e) => setHistorico(e.target.value)}
            rows={8}
            placeholder="Ex.: Fundada em 1995, a entidade tem por missão promover…"
            className="w-full border border-gray-300 rounded-lg shadow-sm p-3 text-sm leading-relaxed focus:ring-lie-green focus:border-lie-green resize-y"
          />
          <div className="text-right text-xs text-gray-400 mt-1">{historico.length} caracteres</div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
          <label className="flex items-center gap-2 text-base font-bold text-lie-ink mb-1">
            <Award className="w-5 h-5 text-amber-600" />
            Descritivo da Capacidade Técnica
          </label>
          <p className="text-xs text-gray-500 mb-3">
            Equipe técnica, infraestrutura, experiências anteriores, parcerias e certificações.
            Os <strong>documentos comprobatórios</strong> vão na seção abaixo.
          </p>
          <textarea
            value={capacidadeTecnica}
            onChange={(e) => setCapacidadeTecnica(e.target.value)}
            rows={8}
            placeholder="Ex.: A entidade conta com equipe técnica multidisciplinar composta por…"
            className="w-full border border-gray-300 rounded-lg shadow-sm p-3 text-sm leading-relaxed focus:ring-lie-green focus:border-lie-green resize-y"
          />
          <div className="text-right text-xs text-gray-400 mt-1">{capacidadeTecnica.length} caracteres</div>
        </div>

        <div className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-xl p-3">
          <div className="text-xs text-gray-500">
            {savedTextoAt && (
              <span className="flex items-center gap-1.5 text-green-700">
                <CheckCircle2 className="w-4 h-4" />
                Textos salvos às {savedTextoAt.toLocaleTimeString('pt-BR')}
              </span>
            )}
          </div>
          <button
            onClick={handleSalvarTextos}
            disabled={savingTexto}
            className="px-5 py-2 bg-lie-green text-white font-bold rounded-lg hover:bg-lie-greenDark transition flex items-center gap-2 shadow-sm disabled:opacity-50"
          >
            {savingTexto ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {savingTexto ? 'Salvando…' : 'Salvar textos'}
          </button>
        </div>
      </div>

      {/* ===== DOCUMENTOS COMPROBATÓRIOS ===== */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-bold text-lie-ink flex items-center gap-2">
              <FileText className="w-5 h-5 text-amber-600" />
              Documentos Comprobatórios
              {documentos.length > 0 && (
                <span className="text-xs font-normal text-gray-500">({documentos.length})</span>
              )}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Selecione um ou vários PDFs (até {MAX_FILE_MB}MB cada). Upload em lote com progresso individual.
            </p>
          </div>
          <button
            onClick={handlePickFiles}
            disabled={uploadingBatch}
            className="flex items-center gap-2 bg-amber-500 text-white px-4 py-2 rounded-lg font-bold hover:bg-amber-600 transition shadow-sm disabled:opacity-50"
          >
            {uploadingBatch ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {uploadingBatch ? 'Enviando…' : 'Adicionar Documentos'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            multiple
            className="hidden"
            onChange={handleFilesSelected}
          />
        </div>

        {/* Fila de upload */}
        {uploadQueue.length > 0 && (
          <div className="p-4 bg-amber-50/40 border-b border-amber-100">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs font-bold text-amber-900">
                {uploadingBatch
                  ? `Enviando ${concluidos} de ${uploadQueue.length}…`
                  : `Concluído: ${concluidos} enviado(s)${comErro > 0 ? `, ${comErro} com erro` : ''}`
                }
              </div>
              {!uploadingBatch && (
                <button
                  onClick={limparQueue}
                  className="text-xs font-bold text-amber-700 hover:text-amber-900 flex items-center gap-1"
                >
                  <X className="w-3.5 h-3.5" />
                  Limpar fila
                </button>
              )}
            </div>

            {/* Barra global */}
            <div className="mb-3">
              <div className="w-full bg-amber-100 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-amber-500 h-full transition-all"
                  style={{ width: `${totalProgress}%` }}
                />
              </div>
              <div className="text-[10px] text-amber-700 text-right mt-0.5 font-mono">
                {totalProgress.toFixed(0)}% geral
              </div>
            </div>

            {/* Por arquivo */}
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {uploadQueue.map(it => (
                <div key={it.id} className="bg-white border border-amber-200 rounded-lg p-2.5">
                  <div className="flex items-center justify-between mb-1 gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {it.status === 'done' && <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />}
                      {it.status === 'uploading' && <Loader2 className="w-4 h-4 text-amber-600 animate-spin shrink-0" />}
                      {it.status === 'pending' && <Upload className="w-4 h-4 text-gray-400 shrink-0" />}
                      {it.status === 'error' && <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />}
                      <span className="text-xs font-bold text-gray-800 truncate">{it.file.name}</span>
                      <span className="text-[10px] text-gray-500 shrink-0">{formatBytes(it.file.size)}</span>
                    </div>
                    <span className={`text-[10px] font-mono shrink-0 ${
                      it.status === 'done' ? 'text-green-700' :
                      it.status === 'error' ? 'text-red-700' :
                      'text-amber-700'
                    }`}>
                      {it.status === 'error' ? 'erro' : `${it.progress.toFixed(0)}%`}
                    </span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        it.status === 'done' ? 'bg-green-500' :
                        it.status === 'error' ? 'bg-red-500' :
                        'bg-amber-500'
                      }`}
                      style={{ width: `${it.progress}%` }}
                    />
                  </div>
                  {it.error && (
                    <p className="text-[10px] text-red-700 mt-1">{it.error}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {documentos.length === 0 ? (
          <div className="p-10 text-center text-gray-400">
            <FileText className="w-10 h-10 mx-auto mb-2 text-gray-300" />
            <p className="text-sm italic">Nenhum documento comprobatório enviado.</p>
            <button
              onClick={handlePickFiles}
              className="mt-3 text-amber-600 font-bold text-sm hover:underline"
            >
              Selecionar arquivos…
            </button>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {documentos.map(d => (
              <div key={d.id} className="p-4 flex items-start gap-3 hover:bg-gray-50 transition">
                <div className="p-2 rounded-lg bg-amber-100 text-amber-700 border border-amber-200 shrink-0">
                  <FileText className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-lie-ink truncate">{d.arquivoNome || d.nome}</div>
                  <div className="text-[11px] text-gray-500 mt-0.5 flex items-center gap-2 flex-wrap">
                    {d.criadoEm && <span>Enviado em {formatDate(d.criadoEm)}</span>}
                    {d.tamanho && <span>• {formatBytes(d.tamanho)}</span>}
                    {d.tipo && <span>• {d.tipo}</span>}
                    {d.ano && <span>• {d.ano}</span>}
                    {d.orgaoEmitente && <span>• {d.orgaoEmitente}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {d.arquivoUrl && (
                    <a
                      href={d.arquivoUrl} target="_blank" rel="noopener noreferrer"
                      title="Visualizar"
                      className="p-2 text-blue-600 hover:bg-blue-50 rounded transition"
                    >
                      <Eye className="w-4 h-4" />
                    </a>
                  )}
                  <button
                    onClick={() => handleExcluirDoc(d)}
                    title="Excluir"
                    className="p-2 text-red-500 hover:bg-red-50 rounded transition"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
