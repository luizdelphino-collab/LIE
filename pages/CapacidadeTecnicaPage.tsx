import { useEffect, useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  doc, getDoc, setDoc, serverTimestamp, collection, getDocs, deleteDoc, Timestamp
} from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import {
  ArrowLeft, Save, Award, BookOpen, Loader2, CheckCircle2, Plus, FileText,
  Trash2, Eye, Upload, Briefcase, ScrollText, FileCheck, FileQuestion, Edit3
} from 'lucide-react';
import { db, storage } from '../lib/firebase';
import type { Entidade } from '../types';

type TipoDocumento = 'portfolio' | 'atestado' | 'contrato' | 'outro';

interface CapacidadeDocumento {
  id: string;
  nome: string;
  tipo: TipoDocumento;
  ano: number;
  orgaoEmitente?: string;
  arquivoUrl: string;
  arquivoNome?: string;
  criadoEm?: Timestamp;
}

const TIPO_LABELS: Record<TipoDocumento, { label: string; color: string; icon: any }> = {
  portfolio:  { label: 'Portfólio',           color: 'bg-indigo-100 text-indigo-800 border-indigo-200', icon: Briefcase },
  atestado:   { label: 'Atestado',            color: 'bg-emerald-100 text-emerald-800 border-emerald-200', icon: FileCheck },
  contrato:   { label: 'Contrato em Vigência', color: 'bg-amber-100 text-amber-800 border-amber-200', icon: ScrollText },
  outro:      { label: 'Outro',               color: 'bg-gray-100 text-gray-700 border-gray-200', icon: FileQuestion },
};

const ANO_ATUAL = new Date().getFullYear();

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
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Partial<CapacidadeDocumento>>({
    nome: '', tipo: 'atestado', ano: ANO_ATUAL, orgaoEmitente: ''
  });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [savingDoc, setSavingDoc] = useState(false);
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
      if (b.ano !== a.ano) return b.ano - a.ano;
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

  const openNew = () => {
    setEditId(null);
    setFormData({ nome: '', tipo: 'atestado', ano: ANO_ATUAL, orgaoEmitente: '' });
    setSelectedFile(null);
    setUploadProgress(0);
    setIsFormOpen(true);
  };

  const openEdit = (d: CapacidadeDocumento) => {
    setEditId(d.id);
    setFormData({ nome: d.nome, tipo: d.tipo, ano: d.ano, orgaoEmitente: d.orgaoEmitente || '' });
    setSelectedFile(null);
    setUploadProgress(0);
    setIsFormOpen(true);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) {
      alert('Arquivo maior que 10MB. Comprima ou divida o documento.');
      return;
    }
    setSelectedFile(f);
  };

  const handleSubmitDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    if (!formData.nome || !formData.tipo || !formData.ano) {
      alert('Preencha nome, tipo e ano.');
      return;
    }
    if (!editId && !selectedFile) {
      alert('Selecione um arquivo PDF.');
      return;
    }

    setSavingDoc(true);
    try {
      const docId = editId || doc(collection(db, `entities/${id}/capacidadeDocumentos`)).id;
      let arquivoUrl = documentos.find(d => d.id === editId)?.arquivoUrl || '';
      let arquivoNome = documentos.find(d => d.id === editId)?.arquivoNome || '';

      if (selectedFile) {
        const ext = selectedFile.name.split('.').pop();
        const path = `entities/${id}/capacidade_tecnica/${docId}_${Date.now()}.${ext}`;
        const fileRef = ref(storage, path);
        const task = uploadBytesResumable(fileRef, selectedFile);
        await new Promise<void>((resolve, reject) => {
          task.on('state_changed',
            (s) => setUploadProgress((s.bytesTransferred / s.totalBytes) * 100),
            reject,
            async () => {
              arquivoUrl = await getDownloadURL(task.snapshot.ref);
              arquivoNome = selectedFile.name;
              resolve();
            }
          );
        });
      }

      const payload: any = {
        id: docId,
        nome: formData.nome,
        tipo: formData.tipo,
        ano: Number(formData.ano),
        orgaoEmitente: formData.orgaoEmitente || '',
        arquivoUrl,
        arquivoNome
      };
      if (!editId) payload.criadoEm = serverTimestamp();

      await setDoc(doc(db, `entities/${id}/capacidadeDocumentos`, docId), payload, { merge: true });

      setIsFormOpen(false);
      await carregarDocumentos();
    } catch (err: any) {
      alert(`Erro ao salvar documento: ${err?.message || err}`);
    } finally {
      setSavingDoc(false);
      setUploadProgress(0);
    }
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
          são impressos como uma seção dedicada do consolidado do projeto. Eles comprovam ao parecerista a
          experiência institucional e a capacidade da entidade pra executar o projeto.
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
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-lie-ink flex items-center gap-2">
              <FileText className="w-5 h-5 text-amber-600" />
              Documentos Comprobatórios
              {documentos.length > 0 && (
                <span className="text-xs font-normal text-gray-500">({documentos.length})</span>
              )}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Ordenados por ano (mais recentes primeiro). PDF, até 10MB cada.
            </p>
          </div>
          {!isFormOpen && (
            <button
              onClick={openNew}
              className="flex items-center gap-2 bg-amber-500 text-white px-4 py-2 rounded-lg font-bold hover:bg-amber-600 transition shadow-sm"
            >
              <Plus className="w-4 h-4" />
              Adicionar Documento
            </button>
          )}
        </div>

        {isFormOpen && (
          <form onSubmit={handleSubmitDoc} className="p-5 bg-amber-50/40 border-b border-amber-100 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-xs font-bold text-gray-700 mb-1">Nome do Documento *</label>
                <input
                  type="text" required
                  value={formData.nome || ''}
                  onChange={(e) => setFormData(p => ({ ...p, nome: e.target.value }))}
                  placeholder="Ex.: Atestado de Capacidade Técnica - Prefeitura de São Paulo"
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm focus:ring-lie-green focus:border-lie-green"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Tipo *</label>
                <select
                  required
                  value={formData.tipo}
                  onChange={(e) => setFormData(p => ({ ...p, tipo: e.target.value as TipoDocumento }))}
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm focus:ring-lie-green focus:border-lie-green"
                >
                  <option value="portfolio">Portfólio</option>
                  <option value="atestado">Atestado de Capacidade</option>
                  <option value="contrato">Contrato em Vigência</option>
                  <option value="outro">Outro</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Ano *</label>
                <input
                  type="number" required
                  min={1950} max={ANO_ATUAL + 1}
                  value={formData.ano || ANO_ATUAL}
                  onChange={(e) => setFormData(p => ({ ...p, ano: Number(e.target.value) }))}
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm focus:ring-lie-green focus:border-lie-green"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-bold text-gray-700 mb-1">Órgão Emitente / Contratante</label>
                <input
                  type="text"
                  value={formData.orgaoEmitente || ''}
                  onChange={(e) => setFormData(p => ({ ...p, orgaoEmitente: e.target.value }))}
                  placeholder="Ex.: Secretaria Municipal de Esportes"
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm focus:ring-lie-green focus:border-lie-green"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Arquivo PDF {editId ? '(opcional: selecione para substituir)' : '*'}
                </label>
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-gray-300 rounded-lg p-4 flex items-center justify-center gap-2 cursor-pointer hover:border-amber-400 hover:bg-amber-50 transition text-sm text-gray-500"
                >
                  <Upload className="w-4 h-4" />
                  {selectedFile ? <span className="font-bold text-amber-700">{selectedFile.name}</span> : 'Clique para selecionar (PDF, até 10MB)'}
                </div>
                <input
                  ref={fileInputRef} type="file" accept="application/pdf"
                  className="hidden" onChange={handleFileChange}
                />
                {uploadProgress > 0 && uploadProgress < 100 && (
                  <div className="w-full bg-gray-200 rounded-full h-2 mt-2 overflow-hidden">
                    <div className="bg-amber-500 h-full transition-all" style={{ width: `${uploadProgress}%` }} />
                  </div>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-amber-200">
              <button
                type="button"
                onClick={() => { setIsFormOpen(false); setEditId(null); }}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 font-bold rounded-lg transition"
              >
                Cancelar
              </button>
              <button
                type="submit" disabled={savingDoc}
                className="px-5 py-2 bg-amber-500 text-white font-bold rounded-lg hover:bg-amber-600 transition flex items-center gap-2 disabled:opacity-50"
              >
                {savingDoc ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {savingDoc ? 'Salvando…' : (editId ? 'Atualizar' : 'Adicionar')}
              </button>
            </div>
          </form>
        )}

        {documentos.length === 0 && !isFormOpen ? (
          <div className="p-10 text-center text-gray-400">
            <FileText className="w-10 h-10 mx-auto mb-2 text-gray-300" />
            <p className="text-sm italic">Nenhum documento comprobatório cadastrado.</p>
            <button
              onClick={openNew}
              className="mt-3 text-amber-600 font-bold text-sm hover:underline"
            >
              Adicionar o primeiro
            </button>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {documentos.map(d => {
              const t = TIPO_LABELS[d.tipo];
              const Icon = t.icon;
              return (
                <div key={d.id} className="p-4 flex items-start gap-3 hover:bg-gray-50 transition">
                  <div className={`p-2 rounded-lg ${t.color} border shrink-0`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-lie-ink">{d.nome}</span>
                      <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded ${t.color} border`}>
                        {t.label}
                      </span>
                      <span className="text-xs font-bold text-gray-600 bg-gray-100 px-2 py-0.5 rounded">
                        {d.ano}
                      </span>
                    </div>
                    {d.orgaoEmitente && (
                      <p className="text-xs text-gray-600 mt-1">{d.orgaoEmitente}</p>
                    )}
                    {d.arquivoNome && (
                      <p className="text-[11px] text-gray-400 mt-0.5 truncate">{d.arquivoNome}</p>
                    )}
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
                      onClick={() => openEdit(d)}
                      title="Editar"
                      className="p-2 text-gray-500 hover:bg-gray-100 rounded transition"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleExcluirDoc(d)}
                      title="Excluir"
                      className="p-2 text-red-500 hover:bg-red-50 rounded transition"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
