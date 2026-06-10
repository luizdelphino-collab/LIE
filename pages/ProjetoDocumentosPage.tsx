import { useEffect, useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { collection, query, getDocs, doc, getDoc, setDoc, deleteDoc, serverTimestamp, Timestamp, deleteField } from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { ArrowLeft, Plus, FileText, Trash2, Edit3, Eye, ArrowUp, ArrowDown, Loader2 } from 'lucide-react';
import { db, storage } from '../lib/firebase';
import type { DocumentoProjeto, Projeto } from '../types';

const TIPOS_DOC: string[] = [
  'Edital', 'Termo de Referência', 'Chamamento Público', 'Portaria', 
  'Declaração', 'Orçamento', 'Pesquisa de Preço', 'Outro'
];

export default function ProjetoDocumentosPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [projeto, setProjeto] = useState<Projeto | null>(null);
  const [documentos, setDocumentos] = useState<DocumentoProjeto[]>([]);
  const [loading, setLoading] = useState(true);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [editId, setEditId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const [formData, setFormData] = useState<Partial<DocumentoProjeto>>({
    nome: '',
    tipo: 'Edital',
    dataAssinatura: undefined,
    observacao: '',
    arquivoUrl: ''
  });

  const carregarDados = async () => {
    if (!id) return;
    try {
      setLoading(true);
      const projRef = doc(db, 'projects', id);
      const projSnap = await getDoc(projRef);
      if (projSnap.exists()) {
        setProjeto({ id: projSnap.id, ...projSnap.data() } as Projeto);
      }

      const docsRef = collection(db, `projects/${id}/documentos`);
      const docsSnap = await getDocs(docsRef);
      const docsList = docsSnap.docs.map(d => ({ id: d.id, ...d.data() } as DocumentoProjeto));
      
      docsList.sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
      setDocumentos(docsList);
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
    if (name === 'dataAssinatura') {
      const date = value ? Timestamp.fromDate(new Date(value + 'T12:00:00')) : undefined;
      setFormData(prev => ({ ...prev, [name]: date }));
    } else {
      setFormData(prev => ({ ...prev, [name]: value }));
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
    }
  };

  const openNewForm = () => {
    setEditId(null);
    setFormData({ nome: '', tipo: 'Edital', dataAssinatura: undefined, observacao: '', arquivoUrl: '' });
    setSelectedFile(null);
    setUploadProgress(0);
    setIsFormOpen(true);
  };

  const openEditForm = (doc: DocumentoProjeto) => {
    setEditId(doc.id);
    setFormData({ ...doc });
    setSelectedFile(null);
    setUploadProgress(0);
    setIsFormOpen(true);
  };

  const deleteDocument = async (docId: string) => {
    if (!confirm("Tem certeza que deseja excluir este documento?")) return;
    try {
      await deleteDoc(doc(db, `projects/${id}/documentos`, docId));
      setDocumentos(prev => prev.filter(d => d.id !== docId));
    } catch (e) {
      console.error(e);
      alert("Erro ao excluir documento");
    }
  };

  const moveDocument = async (index: number, direction: 'up' | 'down') => {
    const newDocs = [...documentos];
    if (direction === 'up' && index > 0) {
      [newDocs[index - 1], newDocs[index]] = [newDocs[index], newDocs[index - 1]];
    } else if (direction === 'down' && index < newDocs.length - 1) {
      [newDocs[index + 1], newDocs[index]] = [newDocs[index], newDocs[index + 1]];
    } else {
      return;
    }

    newDocs.forEach((d, i) => d.ordem = i);
    setDocumentos(newDocs);

    try {
      for (const d of newDocs) {
        await setDoc(doc(db, `projects/${id}/documentos`, d.id), { ordem: d.ordem }, { merge: true });
      }
    } catch (e) {
      console.error("Erro ao reordenar", e);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    setSaving(true);
    try {
      const docId = editId || doc(collection(db, `projects/${id}/documentos`)).id;
      let finalUrl = formData.arquivoUrl;

      if (selectedFile) {
        const ext = selectedFile.name.split('.').pop();
        const path = `projects/${id}/documentos/${docId}_${Date.now()}.${ext}`;
        const fileRef = ref(storage, path);
        
        const uploadTask = uploadBytesResumable(fileRef, selectedFile);
        
        await new Promise<void>((resolve, reject) => {
          uploadTask.on('state_changed', 
            (snapshot) => {
              const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
              setUploadProgress(progress);
            }, 
            (error) => {
              console.error(error);
              reject(error);
            }, 
            async () => {
              finalUrl = await getDownloadURL(uploadTask.snapshot.ref);
              resolve();
            }
          );
        });
      }

      if (!finalUrl && !editId) {
        alert("Por favor, selecione um arquivo.");
        setSaving(false);
        return;
      }

      const payload: any = {
        ...formData,
        id: docId,
        projectId: id,
        arquivoUrl: finalUrl,
      };

      Object.keys(payload).forEach(key => {
        if (payload[key] === undefined) {
          payload[key] = deleteField();
        }
      });

      if (!editId) {
        payload.criadoEm = serverTimestamp();
        payload.ordem = documentos.length;
      }

      await setDoc(doc(db, `projects/${id}/documentos`, docId), payload, { merge: true });
      
      setIsFormOpen(false);
      carregarDados();
    } catch (error: any) {
      console.error(error);
      alert(`Erro técnico: ${error?.message || error}`);
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (ts?: any) => {
    if (!ts) return '-';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString('pt-BR');
  };

  const getDateStringForInput = (ts?: any) => {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toISOString().split('T')[0];
  };

  if (loading) return <div className="p-6 text-lie-gray">Carregando…</div>;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate(`/projetos/${id}`)} className="p-2 text-lie-gray hover:bg-gray-100 rounded-lg transition">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-lie-ink">Documentos do Projeto</h1>
            <p className="text-sm text-lie-gray">{projeto?.titulo}</p>
          </div>
        </div>
        {!isFormOpen && (
          <button 
            onClick={openNewForm} 
            className="group flex items-center bg-lie-green text-white rounded-lg p-2 transition-all duration-300 overflow-hidden hover:bg-lie-greenDark shadow-sm"
          >
            <Plus className="w-5 h-5 shrink-0" />
            <span className="max-w-0 opacity-0 group-hover:max-w-xs group-hover:opacity-100 group-hover:ml-2 whitespace-nowrap transition-all duration-300 ease-in-out font-medium">
              Novo Documento
            </span>
          </button>
        )}
      </header>

      {isFormOpen && (
        <div className="bg-white rounded-xl shadow-premium p-6 border border-gray-100 mb-6 animate-fade-in">
          <h2 className="text-lg font-bold text-lie-ink mb-4">{editId ? 'Editar Documento' : 'Novo Documento'}</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Tipo de Documento *</label>
                <select name="tipo" required value={formData.tipo} onChange={handleChange} className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-lie-green focus:border-lie-green">
                  {TIPOS_DOC.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Nome do Documento *</label>
                <input type="text" name="nome" required value={formData.nome} onChange={handleChange} className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-lie-green focus:border-lie-green" />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Data Assinatura (Opcional)</label>
                <input type="date" name="dataAssinatura" value={getDateStringForInput(formData.dataAssinatura)} onChange={handleChange} className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-lie-green focus:border-lie-green" />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Arquivo {editId ? '(Opcional: trocar)' : '*'}</label>
                <input type="file" accept="application/pdf" ref={fileInputRef} onChange={handleFileChange} className="w-full border-gray-300 rounded-lg shadow-sm text-sm" />
                <p className="text-[10px] text-gray-400 mt-1 uppercase font-bold tracking-wider">Somente PDF • Máximo 10MB</p>
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-bold text-gray-700 mb-1">Observações</label>
                <textarea name="observacao" rows={2} value={formData.observacao} onChange={handleChange} className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-lie-green focus:border-lie-green"></textarea>
              </div>
            </div>
            
            {uploadProgress > 0 && uploadProgress < 100 && (
              <div className="w-full bg-gray-200 rounded-full h-2.5 mt-4">
                <div className="bg-lie-green h-2.5 rounded-full transition-all" style={{ width: `${uploadProgress}%` }}></div>
                <p className="text-[10px] text-gray-500 mt-1 text-right">{Math.round(uploadProgress)}% enviado...</p>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
              <button type="button" onClick={() => setIsFormOpen(false)} className="px-4 py-2 text-gray-700 hover:bg-gray-100 font-medium rounded-lg transition">Cancelar</button>
              <button type="submit" disabled={saving} className="bg-lie-green hover:bg-lie-greenDark text-white px-8 py-2 font-bold rounded-lg shadow-sm transition disabled:opacity-50 flex items-center gap-2">
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {saving ? 'Salvando...' : 'Salvar Documento'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-premium overflow-hidden border border-gray-100">
        {documentos.length === 0 ? (
          <div className="p-12 text-center text-lie-gray italic">Nenhum documento anexado ao projeto ainda.</div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 text-left text-xs uppercase text-lie-gray border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 w-16 text-center">Ordem</th>
                <th className="px-4 py-3">Documento</th>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3 text-center">Assinatura</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {documentos.map((doc, index) => (
                <tr key={doc.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 text-center">
                    <div className="flex flex-col items-center gap-1 text-gray-400">
                      <button onClick={() => moveDocument(index, 'up')} disabled={index === 0} className="hover:text-lie-ink disabled:opacity-30"><ArrowUp className="w-4 h-4" /></button>
                      <button onClick={() => moveDocument(index, 'down')} disabled={index === documentos.length - 1} className="hover:text-lie-ink disabled:opacity-30"><ArrowDown className="w-4 h-4" /></button>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-bold text-lie-ink">{doc.nome}</div>
                    {doc.observacao && <div className="text-[11px] text-lie-gray truncate max-w-md">{doc.observacao}</div>}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    <span className="px-2 py-0.5 bg-gray-100 rounded text-xs font-medium">{doc.tipo}</span>
                  </td>
                  <td className="px-4 py-3 text-sm text-center text-gray-500">{formatDate(doc.dataAssinatura)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {doc.arquivoUrl && (
                        <a href={doc.arquivoUrl} target="_blank" rel="noopener noreferrer" className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition" title="Visualizar">
                          <Eye className="w-4 h-4" />
                        </a>
                      )}
                      <button onClick={() => openEditForm(doc)} className="p-1.5 text-lie-ink hover:bg-gray-100 rounded transition" title="Editar">
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button onClick={() => deleteDocument(doc.id)} className="p-1.5 text-red-500 hover:bg-red-50 rounded transition" title="Excluir">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
