import { useEffect, useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { collection, query, getDocs, doc, getDoc, setDoc, deleteDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { ArrowLeft, Plus, FileText, Trash2, Edit3, Eye, ArrowUp, ArrowDown, Download } from 'lucide-react';
import { db, storage } from '../lib/firebase';
import type { DocumentoEntidade, Entidade } from '../types';

export default function EntidadeDocumentosPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [entidade, setEntidade] = useState<Entidade | null>(null);
  const [documentos, setDocumentos] = useState<DocumentoEntidade[]>([]);
  const [loading, setLoading] = useState(true);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [editId, setEditId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const [formData, setFormData] = useState<Partial<DocumentoEntidade>>({
    nome: '',
    tipo: 'Ata',
    emissao: undefined,
    validade: undefined,
    observacao: '',
    arquivoUrl: ''
  });

  const carregarDados = async () => {
    if (!id) return;
    try {
      setLoading(true);
      const entRef = doc(db, 'entities', id);
      const entSnap = await getDoc(entRef);
      if (entSnap.exists()) {
        setEntidade({ id: entSnap.id, ...entSnap.data() } as Entidade);
      }

      const docsRef = collection(db, `entities/${id}/documentos`);
      const docsSnap = await getDocs(docsRef);
      const docsList = docsSnap.docs.map(d => ({ id: d.id, ...d.data() } as DocumentoEntidade));
      
      // Ordenar por ordem ou data
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
    if (name === 'emissao' || name === 'validade') {
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
    setFormData({ nome: '', tipo: 'Ata', emissao: undefined, validade: undefined, observacao: '', arquivoUrl: '' });
    setSelectedFile(null);
    setIsFormOpen(true);
  };

  const openEditForm = (doc: DocumentoEntidade) => {
    setEditId(doc.id);
    setFormData({ ...doc });
    setSelectedFile(null);
    setIsFormOpen(true);
  };

  const deleteDocument = async (docId: string) => {
    if (!confirm("Tem certeza que deseja excluir este documento?")) return;
    try {
      await deleteDoc(doc(db, `entities/${id}/documentos`, docId));
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

    // Atualiza as ordens locais
    newDocs.forEach((d, i) => d.ordem = i);
    setDocumentos(newDocs);

    // Salva as novas ordens no banco
    try {
      for (const d of newDocs) {
        await setDoc(doc(db, `entities/${id}/documentos`, d.id), { ordem: d.ordem }, { merge: true });
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
      const docId = editId || doc(collection(db, `entities/${id}/documentos`)).id;
      let finalUrl = formData.arquivoUrl;

      if (selectedFile) {
        const ext = selectedFile.name.split('.').pop();
        const path = `entities/${id}/documentos/${docId}_${Date.now()}.${ext}`;
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
        alert("Por favor, selecione um arquivo PDF.");
        setSaving(false);
        return;
      }

      const payload = {
        ...formData,
        id: docId,
        entidadeId: id,
        arquivoUrl: finalUrl,
      };

      if (!editId) {
        payload.criadoEm = serverTimestamp() as Timestamp;
        payload.ordem = documentos.length;
      }

      await setDoc(doc(db, `entities/${id}/documentos`, docId), payload as any, { merge: true });
      
      setIsFormOpen(false);
      carregarDados();
    } catch (error: any) {
      console.error(error);
      alert(`Erro técnico: ${error?.message || error}. Verifique se é problema de permissão no Firebase ou tamanho do arquivo.`);
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (ts?: any) => {
    if (!ts) return '-';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString('pt-BR');
  };

  const getStatus = (ts?: any) => {
    if (!ts) return { text: 'Ativo', color: 'bg-green-100 text-green-800' };
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    if (d.getTime() < new Date().getTime()) {
      return { text: 'Inativo/Vencido', color: 'bg-red-100 text-red-800' };
    }
    return { text: 'Ativo', color: 'bg-green-100 text-green-800' };
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
          <button onClick={() => navigate(`/entidades/${id}`)} className="p-2 text-lie-gray hover:bg-gray-100 rounded-lg">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-lie-ink">Documentos da Entidade</h1>
            <p className="text-sm text-lie-gray">{entidade?.nome}</p>
          </div>
        </div>
        {!isFormOpen && (
          <button onClick={openNewForm} className="inline-flex items-center gap-2 bg-lie-green hover:bg-lie-greenDark text-white font-medium px-4 py-2 rounded-lg transition">
            <Plus className="w-4 h-4" /> Novo Documento
          </button>
        )}
      </header>

      {isFormOpen ? (
        <div className="bg-white rounded-xl shadow-premium p-6 border border-gray-100 mb-6">
          <h2 className="text-lg font-semibold text-lie-ink mb-4">{editId ? 'Editar Documento' : 'Novo Documento'}</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tipo de Documento *</label>
                <select name="tipo" required value={formData.tipo} onChange={handleChange} className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-lie-green focus:border-lie-green">
                  <option value="Ata">Ata</option>
                  <option value="Estatuto">Estatuto</option>
                  <option value="Contrato Social">Contrato Social</option>
                  <option value="Certidão">Certidão</option>
                  <option value="CNPJ">CNPJ</option>
                  <option value="Comprovante de Endereço">Comprovante de Endereço</option>
                  <option value="Capacidade Técnica e Operacional">Capacidade Técnica e Operacional</option>
                  <option value="Portfólio">Portfólio</option>
                  <option value="Outro">Outro</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nome do Documento *</label>
                <input type="text" name="nome" required value={formData.nome} onChange={handleChange} className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-lie-green focus:border-lie-green" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Data de Emissão</label>
                <input type="date" name="emissao" value={getDateStringForInput(formData.emissao)} onChange={handleChange} className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-lie-green focus:border-lie-green" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Data de Validade</label>
                <input type="date" name="validade" value={getDateStringForInput(formData.validade)} onChange={handleChange} className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-lie-green focus:border-lie-green" />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Arquivo PDF {editId ? '(Opcional: selecionar para substituir)' : '*'}</label>
                <input type="file" accept="application/pdf" ref={fileInputRef} onChange={handleFileChange} className="w-full border-gray-300 rounded-lg shadow-sm text-sm" />
                {formData.arquivoUrl && !selectedFile && <p className="text-sm text-blue-600 mt-1">Arquivo atual já salvo.</p>}
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Observações</label>
                <textarea name="observacao" rows={2} value={formData.observacao} onChange={handleChange} className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-lie-green focus:border-lie-green"></textarea>
              </div>
            </div>
            {uploadProgress > 0 && uploadProgress < 100 && (
              <div className="w-full bg-gray-200 rounded-full h-2.5 mt-4">
                <div className="bg-lie-green h-2.5 rounded-full" style={{ width: `${uploadProgress}%` }}></div>
                <p className="text-xs text-gray-500 mt-1 text-right">{Math.round(uploadProgress)}% enviado...</p>
              </div>
            )}
            <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
              <button type="button" onClick={() => setIsFormOpen(false)} className="px-4 py-2 text-gray-700 hover:bg-gray-100 font-medium rounded-lg">Cancelar</button>
              <button type="submit" disabled={saving} className="bg-lie-green hover:bg-lie-greenDark text-white px-6 py-2 font-medium rounded-lg">{saving ? 'Enviando...' : 'Salvar'}</button>
            </div>
          </form>
        </div>
      ) : null}

      <div className="bg-white rounded-xl shadow-premium overflow-hidden">
        {documentos.length === 0 ? (
          <div className="p-8 text-center text-lie-gray">Nenhum documento anexado ainda.</div>
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
              {documentos.map((doc, index) => {
                const status = getStatus(doc.validade);
                return (
                  <tr key={doc.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-center">
                      <div className="flex flex-col items-center gap-1 text-gray-400">
                        <button onClick={() => moveDocument(index, 'up')} disabled={index === 0} className="hover:text-lie-ink disabled:opacity-30"><ArrowUp className="w-4 h-4" /></button>
                        <button onClick={() => moveDocument(index, 'down')} disabled={index === documentos.length - 1} className="hover:text-lie-ink disabled:opacity-30"><ArrowDown className="w-4 h-4" /></button>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-lie-ink">{doc.nome}</div>
                      {doc.observacao && <div className="text-xs text-lie-gray truncate max-w-xs">{doc.observacao}</div>}
                    </td>
                    <td className="px-4 py-3 text-sm">{doc.tipo}</td>
                    <td className="px-4 py-3 text-sm">{formatDate(doc.emissao)}</td>
                    <td className="px-4 py-3 text-sm">{formatDate(doc.validade)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${status.color}`}>
                        {status.text}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {doc.arquivoUrl && (
                          <>
                            <a href={doc.arquivoUrl} target="_blank" rel="noopener noreferrer" className="p-1.5 text-blue-600 hover:bg-blue-50 rounded" title="Visualizar">
                              <Eye className="w-4 h-4" />
                            </a>
                            <a href={doc.arquivoUrl} download={doc.nome} target="_blank" rel="noopener noreferrer" className="p-1.5 text-lie-green hover:bg-green-50 rounded" title="Baixar">
                              <Download className="w-4 h-4" />
                            </a>
                          </>
                        )}
                        <button onClick={() => openEditForm(doc)} className="p-1.5 text-gray-600 hover:bg-gray-100 rounded" title="Editar">
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button onClick={() => deleteDocument(doc.id)} className="p-1.5 text-red-600 hover:bg-red-50 rounded" title="Excluir">
                          <Trash2 className="w-4 h-4" />
                        </button>
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
  );
}
