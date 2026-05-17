import { useEffect, useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { collection, query, getDocs, doc, getDoc, setDoc, deleteDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { ArrowLeft, Plus, FileText, Trash2, Edit3, Eye, ArrowUp, ArrowDown, Loader2 } from 'lucide-react';
import { db, storage } from '../lib/firebase';
import type { DocumentoFornecedor, Fornecedor } from '../types';

const TIPOS_DOC: string[] = ['CNPJ', 'Certidão', 'Estatuto', 'Contrato Social', 'Ata', 'Outro'];

export default function FornecedorDocumentosPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [fornecedor, setFornecedor] = useState<Fornecedor | null>(null);
  const [documentos, setDocumentos] = useState<DocumentoFornecedor[]>([]);
  const [loading, setLoading] = useState(true);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [editId, setEditId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const [formData, setFormData] = useState<Partial<DocumentoFornecedor>>({
    nome: '',
    tipo: 'CNPJ',
    emissao: undefined,
    validade: undefined,
    observacao: '',
    arquivoUrl: ''
  });

  const carregarDados = async () => {
    if (!id) return;
    try {
      setLoading(true);
      const fornSnap = await getDoc(doc(db, 'suppliers', id));
      if (fornSnap.exists()) setFornecedor({ id: fornSnap.id, ...fornSnap.data() } as Fornecedor);

      const snapDocs = await getDocs(collection(db, `suppliers/${id}/documentos`));
      const list = snapDocs.docs.map(d => ({ id: d.id, ...d.data() } as DocumentoFornecedor));
      list.sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
      setDocumentos(list);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregarDados();
  }, [id]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'emissao' || name === 'validade') {
      const date = value ? Timestamp.fromDate(new Date(value + 'T12:00:00')) : undefined;
      setFormData(prev => ({ ...prev, [name]: date }));
    } else {
      setFormData(prev => ({ ...prev, [name]: value }));
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) setSelectedFile(e.target.files[0]);
  };

  const openNew = () => {
    setEditId(null);
    setFormData({ nome: '', tipo: 'CNPJ', observacao: '' });
    setSelectedFile(null);
    setUploadProgress(0);
    setIsFormOpen(true);
  };

  const openEdit = (doc: DocumentoFornecedor) => {
    setEditId(doc.id);
    setFormData({ ...doc });
    setSelectedFile(null);
    setUploadProgress(0);
    setIsFormOpen(true);
  };

  const handleDelete = async (docId: string) => {
    if (!confirm("Excluir documento?")) return;
    try {
      await deleteDoc(doc(db, `suppliers/${id}/documentos`, docId));
      setDocumentos(prev => prev.filter(d => d.id !== docId));
    } catch (e) {
      console.error(e);
    }
  };

  const moveDocument = async (index: number, direction: 'up' | 'down') => {
    const newDocs = [...documentos];
    if (direction === 'up' && index > 0) {
      [newDocs[index - 1], newDocs[index]] = [newDocs[index], newDocs[index - 1]];
    } else if (direction === 'down' && index < newDocs.length - 1) {
      [newDocs[index + 1], newDocs[index]] = [newDocs[index], newDocs[index + 1]];
    } else return;

    newDocs.forEach((d, i) => d.ordem = i);
    setDocumentos(newDocs);
    for (const d of newDocs) {
      await setDoc(doc(db, `suppliers/${id}/documentos`, d.id), { ordem: d.ordem }, { merge: true });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    setSaving(true);
    try {
      const docId = editId || doc(collection(db, `suppliers/${id}/documentos`)).id;
      let finalUrl = formData.arquivoUrl;

      if (selectedFile) {
        const ext = selectedFile.name.split('.').pop();
        const fileRef = ref(storage, `suppliers/${id}/documentos/${docId}_${Date.now()}.${ext}`);
        const uploadTask = uploadBytesResumable(fileRef, selectedFile);
        
        await new Promise<void>((resolve, reject) => {
          uploadTask.on('state_changed', 
            (s) => setUploadProgress((s.bytesTransferred / s.totalBytes) * 100),
            (err) => reject(err),
            async () => {
              finalUrl = await getDownloadURL(uploadTask.snapshot.ref);
              resolve();
            }
          );
        });
      }

      if (!finalUrl && !editId) {
        alert("Selecione um arquivo");
        setSaving(false);
        return;
      }

      const payload = {
        ...formData,
        id: docId,
        fornecedorId: id,
        arquivoUrl: finalUrl,
      };

      if (!editId) {
        payload.criadoEm = serverTimestamp() as Timestamp;
        payload.ordem = documentos.length;
      }

      await setDoc(doc(db, `suppliers/${id}/documentos`, docId), payload as any, { merge: true });
      setIsFormOpen(false);
      carregarDados();
    } catch (e) {
      console.error(e);
      alert("Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (ts?: any) => ts ? (ts.toDate ? ts.toDate() : new Date(ts)).toLocaleDateString('pt-BR') : '-';
  const getDateInput = (ts?: any) => ts ? (ts.toDate ? ts.toDate() : new Date(ts)).toISOString().split('T')[0] : '';

  if (loading) return <div className="p-6 text-lie-gray">Carregando...</div>;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate(`/fornecedores/${id}`)} className="p-2 text-lie-gray hover:bg-gray-100 rounded-lg transition">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-lie-ink">Documentos do Fornecedor</h1>
            <p className="text-sm text-lie-gray">{fornecedor?.razaoSocial}</p>
          </div>
        </div>
        {!isFormOpen && (
          <button onClick={openNew} className="inline-flex items-center gap-2 bg-lie-green hover:bg-lie-greenDark text-white font-medium px-4 py-2 rounded-lg shadow-sm transition">
            <Plus className="w-4 h-4" /> Novo Documento
          </button>
        )}
      </header>

      {isFormOpen && (
        <div className="bg-white rounded-xl shadow-premium p-6 border border-gray-100 mb-6 animate-fade-in">
          <h2 className="text-lg font-bold text-lie-ink mb-4">{editId ? 'Editar Documento' : 'Novo Documento'}</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Tipo *</label>
                <select name="tipo" required value={formData.tipo} onChange={handleChange} className="w-full border-gray-300 rounded-lg shadow-sm">
                  {TIPOS_DOC.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Nome do Documento *</label>
                <input type="text" name="nome" required value={formData.nome} onChange={handleChange} className="w-full border-gray-300 rounded-lg shadow-sm" />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Emissão</label>
                <input type="date" name="emissao" value={getDateInput(formData.emissao)} onChange={handleChange} className="w-full border-gray-300 rounded-lg shadow-sm" />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Validade</label>
                <input type="date" name="validade" value={getDateInput(formData.validade)} onChange={handleChange} className="w-full border-gray-300 rounded-lg shadow-sm" />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-bold text-gray-700 mb-1">Arquivo</label>
                <input type="file" onChange={handleFileChange} className="w-full border-gray-300 rounded-lg shadow-sm text-sm" />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-bold text-gray-700 mb-1">Observações</label>
                <textarea name="observacao" rows={2} value={formData.observacao} onChange={handleChange} className="w-full border-gray-300 rounded-lg shadow-sm" />
              </div>
            </div>
            {uploadProgress > 0 && uploadProgress < 100 && (
              <div className="w-full bg-gray-200 rounded-full h-2 mt-4 overflow-hidden">
                <div className="bg-lie-green h-full transition-all" style={{ width: `${uploadProgress}%` }}></div>
              </div>
            )}
            <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
              <button type="button" onClick={() => setIsFormOpen(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancelar</button>
              <button type="submit" disabled={saving} className="bg-lie-green hover:bg-lie-greenDark text-white px-8 py-2 rounded-lg font-bold shadow-sm flex items-center gap-2">
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {saving ? 'Salvando...' : 'Salvar Documento'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-premium overflow-hidden border border-gray-100">
        <table className="w-full text-left">
          <thead className="bg-gray-50 text-xs font-bold text-lie-gray uppercase border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 w-16 text-center">Ordem</th>
              <th className="px-4 py-3">Documento</th>
              <th className="px-4 py-3">Tipo</th>
              <th className="px-4 py-3">Validade</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {documentos.map((doc, idx) => (
              <tr key={doc.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 text-center">
                  <div className="flex flex-col items-center gap-1 text-gray-400">
                    <button onClick={() => moveDocument(idx, 'up')} disabled={idx === 0} className="hover:text-lie-ink disabled:opacity-30"><ArrowUp className="w-4 h-4" /></button>
                    <button onClick={() => moveDocument(idx, 'down')} disabled={idx === documentos.length - 1} className="hover:text-lie-ink disabled:opacity-30"><ArrowDown className="w-4 h-4" /></button>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="font-bold text-lie-ink">{doc.nome}</div>
                  {doc.observacao && <div className="text-[10px] text-gray-400 truncate max-w-xs">{doc.observacao}</div>}
                </td>
                <td className="px-4 py-3"><span className="px-2 py-0.5 bg-gray-100 rounded text-[10px] font-bold uppercase text-gray-600">{doc.tipo}</span></td>
                <td className="px-4 py-3 text-sm text-gray-500">{formatDate(doc.validade)}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    {doc.arquivoUrl && <a href={doc.arquivoUrl} target="_blank" rel="noopener noreferrer" className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition"><Eye className="w-4 h-4" /></a>}
                    <button onClick={() => openEdit(doc)} className="p-1.5 text-lie-ink hover:bg-gray-100 rounded transition"><Edit3 className="w-4 h-4" /></button>
                    <button onClick={() => handleDelete(doc.id)} className="p-1.5 text-red-500 hover:bg-red-50 rounded transition"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {documentos.length === 0 && <div className="p-12 text-center text-lie-gray italic">Nenhum documento anexado.</div>}
      </div>
    </div>
  );
}
