import { useEffect, useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, getDoc, setDoc, serverTimestamp, collection, Timestamp } from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { getDocs, deleteDoc } from 'firebase/firestore';
import { ArrowLeft, Save, Edit3, FileText, Plus, Eye, Trash2, ArrowUp, ArrowDown, X } from 'lucide-react';
import { db, storage } from '../lib/firebase';
import { fetchCep } from '../lib/cep';
import type { Dirigente, Entidade } from '../types';

const maskCpf = (v: string) => {
  v = v.replace(/\D/g, '');
  v = v.replace(/(\d{3})(\d)/, '$1.$2');
  v = v.replace(/(\d{3})(\d)/, '$1.$2');
  v = v.replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  return v.substring(0, 14);
};

const maskCep = (v: string) => {
  v = v.replace(/\D/g, '');
  v = v.replace(/(\d{5})(\d)/, '$1-$2');
  return v.substring(0, 9);
};

const maskPhone = (v: string) => {
  v = v.replace(/\D/g, '');
  v = v.replace(/^(\d{2})(\d)/g, '($1) $2');
  v = v.replace(/(\d)(\d{4})$/, '$1-$2');
  return v.substring(0, 15);
};

const TIPOS_DOCUMENTO = [
  'Documento Pessoal',
  'Comprovante de Endereço',
  'Currículo',
  'Comprovante de Escolaridade',
  'Certidão',
  'Outros',
];

const ESCOLARIDADES = [
  'Ensino Fundamental Incompleto',
  'Ensino Fundamental Completo',
  'Ensino Médio Incompleto',
  'Ensino Médio Completo',
  'Ensino Superior Incompleto',
  'Ensino Superior Completo (Graduação)',
  'Pós-graduação Especialização / MBA',
  'Mestrado',
  'Doutorado / Pós-doutorado',
];

interface DocDirigente {
  id: string;
  nome: string;
  tipo: string;
  emissao?: Timestamp;
  validade?: Timestamp;
  arquivoUrl?: string;
  ordem?: number;
}

export default function DirigenteFormPage() {
  const { id: entidadeId, dirId } = useParams();
  const navigate = useNavigate();
  const isNew = !dirId || dirId === 'novo';

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(isNew);
  const [entidade, setEntidade] = useState<Entidade | null>(null);

  const [formData, setFormData] = useState<Partial<Dirigente>>({
    nome: '', cargo: '', cpf: '', telefone: '', email: '',
    escolaridade: '', cep: '', logradouro: '', bairro: '',
    numero: '', complemento: '', cidade: '', uf: '',
  });

  // Documentos do dirigente
  const [documentos, setDocumentos] = useState<DocDirigente[]>([]);
  const [isDocFormOpen, setIsDocFormOpen] = useState(false);
  const [savingDoc, setSavingDoc] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [editDocId, setEditDocId] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [docForm, setDocForm] = useState<Partial<DocDirigente>>({
    nome: '', tipo: 'Documento Pessoal', emissao: undefined, validade: undefined,
  });

  const carregarDocumentos = async (dId: string) => {
    const snap = await getDocs(collection(db, `entities/${entidadeId}/dirigentes/${dId}/documentos`));
    const lista = snap.docs.map(d => ({ id: d.id, ...d.data() } as DocDirigente));
    lista.sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
    setDocumentos(lista);
  };

  useEffect(() => {
    if (!entidadeId) return;
    (async () => {
      const entSnap = await getDoc(doc(db, 'entities', entidadeId));
      if (entSnap.exists()) setEntidade({ id: entSnap.id, ...entSnap.data() } as Entidade);

      if (!isNew && dirId) {
        try {
          const snap = await getDoc(doc(db, `entities/${entidadeId}/dirigentes`, dirId));
          if (snap.exists()) setFormData(snap.data() as Dirigente);
          await carregarDocumentos(dirId);
        } finally {
          setLoading(false);
        }
      }
    })();
  }, [entidadeId, dirId, isNew]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    let { name, value } = e.target;
    if (name === 'cpf') value = maskCpf(value);
    if (name === 'telefone') value = maskPhone(value);
    if (name === 'cep') value = maskCep(value);
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleCepBlur = async () => {
    if (formData.cep && formData.cep.replace(/\D/g, '').length >= 8) {
      const data = await fetchCep(formData.cep);
      if (data) {
        setFormData(prev => ({
          ...prev,
          logradouro: data.logradouro,
          bairro: data.bairro,
          cidade: data.localidade,
          uf: data.uf,
        }));
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!entidadeId) return;
    setSaving(true);
    try {
      const docId = isNew ? doc(collection(db, `entities/${entidadeId}/dirigentes`)).id : dirId!;
      const payload = { ...formData, entidadeId, atualizadoEm: serverTimestamp() };
      if (isNew) (payload as any).criadoEm = serverTimestamp();
      await setDoc(doc(db, `entities/${entidadeId}/dirigentes`, docId), payload as any, { merge: true });
      setIsEditing(false);
      if (isNew) {
        navigate(`/entidades/${entidadeId}/dirigentes/${docId}`, { replace: true });
      }
    } catch (err) {
      console.error(err);
      alert('Erro ao salvar dirigente.');
    } finally {
      setSaving(false);
    }
  };

  const handleExcluir = async () => {
    if (!dirId || isNew || !entidadeId) return;
    if (!confirm("Excluir este dirigente permanentemente?")) return;
    
    try {
      setSaving(true);
      await deleteDoc(doc(db, `entities/${entidadeId}/dirigentes`, dirId));
      navigate(`/entidades/${entidadeId}/dirigentes`);
    } catch (err) {
      console.error(err);
      alert("Erro ao excluir dirigente.");
      setSaving(false);
    }
  };

  // Documentos handlers
  const handleDocChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (name === 'emissao' || name === 'validade') {
      setDocForm(prev => ({ ...prev, [name]: value ? Timestamp.fromDate(new Date(value + 'T12:00:00')) : undefined }));
    } else {
      setDocForm(prev => ({ ...prev, [name]: value }));
    }
  };

  const getDateStr = (ts?: Timestamp) => {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts as any);
    return d.toISOString().split('T')[0];
  };

  const formatDate = (ts?: Timestamp) => {
    if (!ts) return '-';
    const d = ts.toDate ? ts.toDate() : new Date(ts as any);
    return d.toLocaleDateString('pt-BR');
  };

  const getStatus = (ts?: Timestamp) => {
    if (!ts) return { text: 'Ativo', color: 'bg-green-100 text-green-800' };
    const d = ts.toDate ? ts.toDate() : new Date(ts as any);
    if (d.getTime() < Date.now()) return { text: 'Vencido', color: 'bg-red-100 text-red-800' };
    return { text: 'Ativo', color: 'bg-green-100 text-green-800' };
  };

  const openNewDoc = () => {
    setEditDocId(null);
    setDocForm({ nome: '', tipo: 'Documento Pessoal', emissao: undefined, validade: undefined });
    setSelectedFile(null);
    setUploadProgress(0);
    setIsDocFormOpen(true);
  };

  const openEditDoc = (d: DocDirigente) => {
    setEditDocId(d.id);
    setDocForm({ ...d });
    setSelectedFile(null);
    setUploadProgress(0);
    setIsDocFormOpen(true);
  };

  const deleteDoc_ = async (docId: string) => {
    if (!confirm('Excluir este documento?')) return;
    await deleteDoc(doc(db, `entities/${entidadeId}/dirigentes/${dirId}/documentos`, docId));
    setDocumentos(prev => prev.filter(d => d.id !== docId));
  };

  const moveDoc = async (index: number, direction: 'up' | 'down') => {
    const lista = [...documentos];
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === lista.length - 1) return;
    const swap = direction === 'up' ? index - 1 : index + 1;
    [lista[index], lista[swap]] = [lista[swap], lista[index]];
    lista.forEach((d, i) => { d.ordem = i; });
    setDocumentos(lista);
    for (const d of lista) {
      await setDoc(doc(db, `entities/${entidadeId}/dirigentes/${dirId}/documentos`, d.id), { ordem: d.ordem }, { merge: true });
    }
  };

  const handleDocSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!entidadeId || !dirId) return;
    setSavingDoc(true);
    setUploadProgress(0);
    try {
      const docId = editDocId || doc(collection(db, `entities/${entidadeId}/dirigentes/${dirId}/documentos`)).id;
      let finalUrl = docForm.arquivoUrl || '';

      if (selectedFile) {
        const ext = selectedFile.name.split('.').pop();
        const path = `entities/${entidadeId}/dirigentes/${dirId}/documentos/${docId}_${Date.now()}.${ext}`;
        const fileRef = ref(storage, path);
        const task = uploadBytesResumable(fileRef, selectedFile);
        await new Promise<void>((resolve, reject) => {
          task.on('state_changed',
            (snap) => setUploadProgress((snap.bytesTransferred / snap.totalBytes) * 100),
            reject,
            async () => { finalUrl = await getDownloadURL(task.snapshot.ref); resolve(); }
          );
        });
      }

      if (!finalUrl && !editDocId) {
        alert('Selecione um arquivo PDF.');
        setSavingDoc(false);
        return;
      }

      const payload: any = {
        ...docForm,
        id: docId,
        arquivoUrl: finalUrl,
        ...(editDocId ? {} : { criadoEm: serverTimestamp(), ordem: documentos.length }),
      };
      await setDoc(doc(db, `entities/${entidadeId}/dirigentes/${dirId}/documentos`, docId), payload, { merge: true });
      setIsDocFormOpen(false);
      carregarDocumentos(dirId);
    } catch (err: any) {
      console.error(err);
      alert(`Erro: ${err?.message || err}`);
    } finally {
      setSavingDoc(false);
    }
  };

  if (loading) return <div className="p-6 text-lie-gray">Carregando…</div>;

  const inputCls = 'w-full border-gray-300 rounded-lg shadow-sm disabled:bg-gray-50 disabled:text-gray-500 focus:ring-lie-green focus:border-lie-green';

  return (
    <div className="p-6 max-w-4xl mx-auto pb-28">
      <header className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate(`/entidades/${entidadeId}/dirigentes`)} className="p-2 text-lie-gray hover:bg-gray-100 rounded-lg">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-lie-ink">{isNew ? 'Novo Dirigente' : formData.nome || 'Dirigente'}</h1>
            <p className="text-sm text-lie-gray">{entidade?.nome}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!isNew && !isEditing && (
            <button
              onClick={() => setIsEditing(true)}
              className="group flex items-center bg-lie-green text-white rounded-lg p-2 transition-all duration-300 overflow-hidden hover:bg-lie-greenDark shadow-sm"
              title="Editar"
            >
              <Edit3 className="w-5 h-5 shrink-0" />
              <span className="max-w-0 opacity-0 group-hover:max-w-xs group-hover:opacity-100 group-hover:ml-2 whitespace-nowrap transition-all duration-300 ease-in-out font-medium">
                Editar
              </span>
            </button>
          )}
          {!isNew && !isDocFormOpen && (
            <button
              onClick={openNewDoc}
              className="group flex items-center bg-white border border-gray-300 text-lie-green rounded-lg p-2 transition-all duration-300 overflow-hidden hover:bg-green-50 shadow-sm"
              title="Novo Documento"
            >
              <Plus className="w-5 h-5 shrink-0" />
              <span className="max-w-0 opacity-0 group-hover:max-w-xs group-hover:opacity-100 group-hover:ml-2 whitespace-nowrap transition-all duration-300 ease-in-out font-medium">
                Novo Documento
              </span>
            </button>
          )}
        </div>
      </header>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Dados Pessoais */}
        <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
          <h2 className="text-lg font-semibold text-lie-ink mb-4">Dados Pessoais</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Nome Completo *</label>
              <input type="text" name="nome" required value={formData.nome} onChange={handleChange} disabled={!isEditing} className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">CPF</label>
              <input type="text" name="cpf" placeholder="000.000.000-00" value={formData.cpf} onChange={handleChange} disabled={!isEditing} className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Cargo</label>
              <input type="text" name="cargo" value={formData.cargo} onChange={handleChange} disabled={!isEditing} className={inputCls} />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Escolaridade</label>
              <select name="escolaridade" value={formData.escolaridade} onChange={handleChange} disabled={!isEditing} className={inputCls}>
                <option value="">Selecione...</option>
                {ESCOLARIDADES.map(e => <option key={e} value={e}>{e}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Telefone</label>
              <input type="text" name="telefone" placeholder="(00) 00000-0000" value={formData.telefone} onChange={handleChange} disabled={!isEditing} className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">E-mail</label>
              <input type="email" name="email" value={formData.email} onChange={handleChange} disabled={!isEditing} className={inputCls} />
            </div>
          </div>
        </div>

        {/* Endereço */}
        <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
          <h2 className="text-lg font-semibold text-lie-ink mb-4">Endereço</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">CEP</label>
              <input type="text" name="cep" value={formData.cep} onChange={handleChange} onBlur={handleCepBlur} disabled={!isEditing} className={inputCls} />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Logradouro</label>
              <input type="text" name="logradouro" value={formData.logradouro} onChange={handleChange} disabled={!isEditing} className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Número</label>
              <input type="text" name="numero" value={formData.numero} onChange={handleChange} disabled={!isEditing} className={inputCls} />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Complemento</label>
              <input type="text" name="complemento" value={formData.complemento} onChange={handleChange} disabled={!isEditing} className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Bairro</label>
              <input type="text" name="bairro" value={formData.bairro} onChange={handleChange} disabled={!isEditing} className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Cidade</label>
              <input type="text" name="cidade" value={formData.cidade} onChange={handleChange} disabled={!isEditing} className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">UF</label>
              <input type="text" name="uf" maxLength={2} value={formData.uf} onChange={handleChange} disabled={!isEditing} className={inputCls + ' uppercase'} />
            </div>
          </div>
        </div>

        {/* Rodapé fixo */}
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 shadow-lg z-20">
          <div className="max-w-7xl mx-auto px-6 flex items-center justify-between">
            <div className="flex gap-2">
              <button type="button" onClick={() => isEditing && !isNew ? setIsEditing(false) : navigate(`/entidades/${entidadeId}/dirigentes`)} className="px-4 py-2 text-gray-700 hover:bg-gray-100 font-medium rounded-lg transition">
                {isEditing ? 'Cancelar' : 'Voltar'}
              </button>
              {!isNew && isEditing && (
                <button type="button" onClick={handleExcluir} className="px-4 py-2 text-red-600 hover:bg-red-50 font-medium rounded-lg transition flex items-center gap-2">
                  <Trash2 className="w-4 h-4" /> Excluir Dirigente
                </button>
              )}
            </div>
            <div className="flex gap-3">
              {isEditing && (
                <button type="submit" disabled={saving} className="inline-flex items-center gap-2 bg-lie-green hover:bg-lie-greenDark text-white px-6 py-2 font-medium rounded-lg transition">
                  <Save className="w-4 h-4" /> {saving ? 'Salvando...' : 'Salvar Dirigente'}
                </button>
              )}
            </div>
          </div>
        </div>
      </form>

      {/* Seção de Documentos — só aparece após salvar */}
      {!isNew && (
        <div className="mt-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-lie-ink flex items-center gap-2"><FileText className="w-5 h-5 text-lie-green" /> Documentos do Dirigente</h2>
            {!isDocFormOpen && (
              <button
                onClick={openNewDoc}
                className="group flex items-center bg-white border border-gray-300 text-lie-green rounded-lg p-2 transition-all duration-300 overflow-hidden hover:bg-green-50 shadow-sm"
                title="Novo Documento"
              >
                <Plus className="w-5 h-5 shrink-0" />
                <span className="max-w-0 opacity-0 group-hover:max-w-xs group-hover:opacity-100 group-hover:ml-2 whitespace-nowrap transition-all duration-300 ease-in-out font-medium">
                  Novo Documento
                </span>
              </button>
            )}
          </div>

          {isDocFormOpen && (
            <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100 mb-4">
              <h3 className="font-semibold text-lie-ink mb-4">{editDocId ? 'Editar Documento' : 'Novo Documento'}</h3>
              <form onSubmit={handleDocSubmit} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Tipo *</label>
                    <select name="tipo" required value={docForm.tipo} onChange={handleDocChange} className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-lie-green focus:border-lie-green">
                      {TIPOS_DOCUMENTO.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Nome do Documento *</label>
                    <input type="text" name="nome" required value={docForm.nome} onChange={handleDocChange as any} className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-lie-green focus:border-lie-green" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Data de Emissão</label>
                    <input type="date" name="emissao" value={getDateStr(docForm.emissao)} onChange={handleDocChange} className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-lie-green focus:border-lie-green" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Data de Validade</label>
                    <input type="date" name="validade" value={getDateStr(docForm.validade)} onChange={handleDocChange} className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-lie-green focus:border-lie-green" />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Arquivo PDF {editDocId ? '(opcional: substituir)' : '*'}</label>
                    <input type="file" accept="application/pdf" ref={fileInputRef} onChange={e => setSelectedFile(e.target.files?.[0] || null)} className="w-full text-sm" />
                    <p className="text-[10px] text-gray-400 mt-1 uppercase font-bold tracking-wider">Somente PDF • Máximo 10MB</p>
                    {docForm.arquivoUrl && !selectedFile && <p className="text-xs text-blue-600 mt-1">Arquivo atual já salvo.</p>}
                  </div>
                </div>
                {uploadProgress > 0 && uploadProgress < 100 && (
                  <div className="w-full bg-gray-200 rounded-full h-2.5">
                    <div className="bg-lie-green h-2.5 rounded-full transition-all" style={{ width: `${uploadProgress}%` }}></div>
                    <p className="text-xs text-gray-500 mt-1 text-right">{Math.round(uploadProgress)}% enviado...</p>
                  </div>
                )}
                <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
                  <button type="button" onClick={() => setIsDocFormOpen(false)} className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg">Cancelar</button>
                  <button type="submit" disabled={savingDoc} className="bg-lie-green hover:bg-lie-greenDark text-white px-6 py-2 font-medium rounded-lg">{savingDoc ? 'Enviando...' : 'Salvar'}</button>
                </div>
              </form>
            </div>
          )}

          <div className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100">
            {documentos.length === 0 ? (
              <div className="p-8 text-center text-lie-gray">Nenhum documento cadastrado.</div>
            ) : (
              <table className="w-full">
                <thead className="bg-gray-50 text-left text-xs uppercase text-lie-gray border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 w-16 text-center">Ordem</th>
                    <th className="px-4 py-3">Documento</th>
                    <th className="px-4 py-3">Tipo</th>
                    <th className="px-4 py-3">Emissão</th>
                    <th className="px-4 py-3">Validade</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {documentos.map((d, index) => {
                    const status = getStatus(d.validade);
                    return (
                      <tr key={d.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-center">
                          <div className="flex flex-col items-center gap-0.5 text-gray-400">
                            <button onClick={() => moveDoc(index, 'up')} disabled={index === 0} className="hover:text-lie-ink disabled:opacity-30"><ArrowUp className="w-4 h-4" /></button>
                            <button onClick={() => moveDoc(index, 'down')} disabled={index === documentos.length - 1} className="hover:text-lie-ink disabled:opacity-30"><ArrowDown className="w-4 h-4" /></button>
                          </div>
                        </td>
                        <td className="px-4 py-3 font-medium text-lie-ink">{d.nome}</td>
                        <td className="px-4 py-3 text-sm">{d.tipo}</td>
                        <td className="px-4 py-3 text-sm">{formatDate(d.emissao)}</td>
                        <td className="px-4 py-3 text-sm">{formatDate(d.validade)}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${status.color}`}>{status.text}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {d.arquivoUrl && (
                              <a href={d.arquivoUrl} target="_blank" rel="noopener noreferrer" className="p-1.5 text-blue-600 hover:bg-blue-50 rounded" title="Visualizar">
                                <Eye className="w-4 h-4" />
                              </a>
                            )}
                            <button onClick={() => openEditDoc(d)} className="p-1.5 text-gray-600 hover:bg-gray-100 rounded" title="Editar"><FileText className="w-4 h-4" /></button>
                            <button onClick={() => deleteDoc_(d.id)} className="p-1.5 text-red-500 hover:bg-red-50 rounded" title="Excluir"><Trash2 className="w-4 h-4" /></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
