import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { collection, query, getDocs, doc, getDoc, setDoc, deleteDoc, serverTimestamp, Timestamp, orderBy, writeBatch } from 'firebase/firestore';
import { ArrowLeft, Plus, Search, Trash2, Edit3, Loader2, Calculator, Package, Check, FileSpreadsheet, Scale, ShieldCheck, Folder, Download } from 'lucide-react';
import { db } from '../lib/firebase';
import * as XLSX from 'xlsx';
import type { ItemMaster, ItemProjeto, Projeto, ModuloProjeto } from '../types';
import PesquisaPrecoModal from '../components/PesquisaPrecoModal';

export default function ProjetoItensPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [projeto, setProjeto] = useState<Projeto | null>(null);
  const [itensProjeto, setItensProjeto] = useState<ItemProjeto[]>([]);
  const [modulos, setModulos] = useState<ModuloProjeto[]>([]);
  const [itensMaster, setItensMaster] = useState<ItemMaster[]>([]);
  const [loading, setLoading] = useState(true);

  // Estados de Módulo
  const [isModuloFormOpen, setIsModuloFormOpen] = useState(false);
  const [savingModulo, setSavingModulo] = useState(false);
  const [editModuloId, setEditModuloId] = useState<string | null>(null);
  const [moduloFormData, setModuloFormData] = useState<Partial<ModuloProjeto>>({ nome: '', descricao: '' });

  // Estados para Importação de Módulo
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importProjects, setImportProjects] = useState<Projeto[]>([]);
  const [selectedImportProject, setSelectedImportProject] = useState<string>('');
  const [importModulos, setImportModulos] = useState<ModuloProjeto[]>([]);
  const [selectedImportModulo, setSelectedImportModulo] = useState<string>('');
  const [importing, setImporting] = useState(false);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  
  // Estados para seleção do item base
  const [showItemPicker, setShowItemPicker] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [selectedMaster, setSelectedMaster] = useState<ItemMaster | null>(null);

  // Estados para inclusão em lote
  const [selectedMasters, setSelectedMasters] = useState<ItemMaster[]>([]);
  const [batchData, setBatchData] = useState<Record<string, { memorialCalculo: string; quantidade: number; moduloId: string }>>({});

  const [formData, setFormData] = useState<Partial<ItemProjeto>>({
    memorialCalculo: '',
    quantidade: 1,
    moduloId: ''
  });

  // Estados para pesquisa de preços públicos (IN 65/2021)
  const [isPesquisaOpen, setIsPesquisaOpen] = useState(false);
  const [selectedItemForPesquisa, setSelectedItemForPesquisa] = useState<ItemProjeto | null>(null);

  const carregarDados = async () => {
    if (!id) return;
    try {
      setLoading(true);
      
      // Projeto
      const projSnap = await getDoc(doc(db, 'projects', id));
      if (projSnap.exists()) setProjeto({ id: projSnap.id, ...projSnap.data() } as Projeto);

      // Módulos do Projeto
      const snapModulos = await getDocs(query(collection(db, `projects/${id}/modulos`), orderBy('criadoEm', 'asc')));
      setModulos(snapModulos.docs.map(d => ({ id: d.id, ...d.data() } as ModuloProjeto)));

      // Itens do Projeto
      const snapProj = await getDocs(query(collection(db, `projects/${id}/items`), orderBy('criadoEm', 'asc')));
      setItensProjeto(snapProj.docs.map(d => ({ id: d.id, ...d.data() } as ItemProjeto)));

      // Banco de Itens Master (para seleção)
      const snapMaster = await getDocs(query(collection(db, 'items'), orderBy('nome', 'asc')));
      setItensMaster(snapMaster.docs.map(d => ({ id: d.id, ...d.data() } as ItemMaster)));

    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregarDados();
  }, [id]);

  const exportToExcel = () => {
    if (itensProjeto.length === 0) return;

    const workbook = XLSX.utils.book_new();

    const getRow = (it: ItemProjeto) => {
      const master = itensMaster.find(m => m.id === it.itemId);
      const mod = modulos.find(m => m.id === it.moduloId);
      return {
        'Nº': master ? String(master.codigo).padStart(3, '0') : '-',
        'Módulo': mod ? mod.nome : 'Sem Módulo',
        'Item': it.nome,
        'Descrição': it.descricao || '-',
        'Memorial de Cálculo': it.memorialCalculo,
        'Unidade': it.unidade,
        'Quantidade': it.quantidade,
        'Valor Unitário (R$)': it.valorUnitario,
        'Valor Total (R$)': it.valorTotal
      };
    };

    // Aba Geral
    const geralData = itensProjeto.map(getRow);
    const wsGeral = XLSX.utils.json_to_sheet(geralData);
    XLSX.utils.book_append_sheet(workbook, wsGeral, 'Geral');

    // Abas por Módulo
    modulos.forEach(m => {
      const items = itensProjeto.filter(it => it.moduloId === m.id);
      if (items.length > 0) {
        const ws = XLSX.utils.json_to_sheet(items.map(getRow));
        XLSX.utils.book_append_sheet(workbook, ws, m.nome.substring(0, 31));
      }
    });

    // Aba Sem Módulo
    const noModuleItems = itensProjeto.filter(it => !it.moduloId || !modulos.find(m => m.id === it.moduloId));
    if (noModuleItems.length > 0) {
      const ws = XLSX.utils.json_to_sheet(noModuleItems.map(getRow));
      XLSX.utils.book_append_sheet(workbook, ws, 'Sem Módulo');
    }

    try {
      const wbout = XLSX.write(workbook, { bookType: 'xlsx', type: 'binary' });
      const s2ab = (s: string) => {
        const buf = new ArrayBuffer(s.length);
        const view = new Uint8Array(buf);
        for (let i = 0; i < s.length; i++) {
          view[i] = s.charCodeAt(i) & 0xff;
        }
        return buf;
      };

      const blob = new Blob([s2ab(wbout)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `itens_projeto_${projeto?.titulo || 'projeto'}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Erro ao gerar/baixar Excel:", err);
      alert("Erro ao gerar a planilha. Tentando método simplificado...");
    }
  };

  const openNewModulo = () => {
    setEditModuloId(null);
    setModuloFormData({ nome: '', descricao: '' });
    setIsModuloFormOpen(true);
  };

  const openEditModulo = (mod: ModuloProjeto) => {
    setEditModuloId(mod.id);
    setModuloFormData({ nome: mod.nome, descricao: mod.descricao });
    setIsModuloFormOpen(true);
  };

  const handleModuloSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    setSavingModulo(true);
    try {
      const docId = editModuloId || doc(collection(db, `projects/${id}/modulos`)).id;
      const payload: Partial<ModuloProjeto> = {
        ...moduloFormData,
        id: docId,
        projectId: id,
      };
      if (!editModuloId) {
        payload.criadoEm = serverTimestamp() as Timestamp;
        payload.ordem = modulos.length;
      }
      await setDoc(doc(db, `projects/${id}/modulos`, docId), payload as any, { merge: true });
      setIsModuloFormOpen(false);
      carregarDados();
    } catch (e) {
      console.error(e);
      alert("Erro ao salvar módulo");
    } finally {
      setSavingModulo(false);
    }
  };

  const handleDeleteModulo = async (modId: string) => {
    if (!confirm("Remover este módulo? Os itens vinculados ficarão sem módulo.")) return;
    try {
      await deleteDoc(doc(db, `projects/${id}/modulos`, modId));
      const batch = writeBatch(db);
      const itensDoModulo = itensProjeto.filter(it => it.moduloId === modId);
      itensDoModulo.forEach(it => {
        batch.update(doc(db, `projects/${id}/items`, it.id), { moduloId: '' });
      });
      await batch.commit();
      carregarDados();
    } catch (e) {
      console.error(e);
      alert("Erro ao remover módulo");
    }
  };

  const openImportModal = async () => {
    setIsImportModalOpen(true);
    try {
      const snap = await getDocs(collection(db, 'projects'));
      const projs = snap.docs.map(d => ({ id: d.id, ...d.data() } as Projeto)).filter(p => p.id !== id);
      setImportProjects(projs);
    } catch (e) { console.error(e); }
  };

  const handleSelectImportProject = async (projId: string) => {
    setSelectedImportProject(projId);
    setSelectedImportModulo('');
    if (!projId) {
      setImportModulos([]);
      return;
    }
    try {
      const snap = await getDocs(collection(db, `projects/${projId}/modulos`));
      setImportModulos(snap.docs.map(d => ({ id: d.id, ...d.data() } as ModuloProjeto)));
    } catch(e) { console.error(e); }
  };

  const handleConfirmImport = async () => {
    if (!id || !selectedImportProject || !selectedImportModulo) return;
    setImporting(true);
    try {
      const modToImport = importModulos.find(m => m.id === selectedImportModulo);
      if (!modToImport) return;

      const itemsSnap = await getDocs(query(collection(db, `projects/${selectedImportProject}/items`)));
      const modItems = itemsSnap.docs.map(d => ({ id: d.id, ...d.data() } as ItemProjeto)).filter(it => it.moduloId === selectedImportModulo);

      const batch = writeBatch(db);
      
      const newModId = doc(collection(db, `projects/${id}/modulos`)).id;
      batch.set(doc(db, `projects/${id}/modulos`, newModId), {
        id: newModId,
        projectId: id,
        nome: modToImport.nome,
        descricao: modToImport.descricao,
        ordem: modulos.length,
        criadoEm: serverTimestamp()
      });

      modItems.forEach(it => {
        const newItemId = doc(collection(db, `projects/${id}/items`)).id;
        batch.set(doc(db, `projects/${id}/items`, newItemId), {
          ...it,
          id: newItemId,
          projectId: id,
          moduloId: newModId,
          criadoEm: serverTimestamp()
        });
      });

      await batch.commit();

      setIsImportModalOpen(false);
      setSelectedImportProject('');
      setSelectedImportModulo('');
      setImportModulos([]);
      setIsModuloFormOpen(false);
      carregarDados();
      alert(`Módulo "${modToImport.nome}" e seus ${modItems.length} itens importados com sucesso!`);
    } catch (e) {
      console.error(e);
      alert('Erro ao importar módulo.');
    } finally {
      setImporting(false);
    }
  };

  const openNew = () => {
    setEditId(null);
    setSelectedMaster(null);
    setSelectedMasters([]);
    setBatchData({});
    setFormData({ memorialCalculo: '', quantidade: 1 });
    setShowItemPicker(true);
    setIsFormOpen(true);
  };

  const openEdit = (ip: ItemProjeto) => {
    setEditId(ip.id);
    const master = itensMaster.find(m => m.id === ip.itemId);
    setSelectedMaster(master || null);
    setFormData({ ...ip });
    setShowItemPicker(false);
    setIsFormOpen(true);
  };

  const toggleMasterSelection = (it: ItemMaster) => {
    setSelectedMasters(prev => {
      const exists = prev.some(m => m.id === it.id);
      if (exists) {
        return prev.filter(m => m.id !== it.id);
      } else {
        return [...prev, it];
      }
    });
  };

  const avancarLote = () => {
    const initialBatch: Record<string, { memorialCalculo: string; quantidade: number; moduloId: string }> = {};
    selectedMasters.forEach(m => {
      initialBatch[m.id] = batchData[m.id] || { memorialCalculo: '', quantidade: 1, moduloId: '' };
    });
    setBatchData(initialBatch);
    setShowItemPicker(false);
  };

  const selectMasterItem = (it: ItemMaster) => {
    setSelectedMaster(it);
    setShowItemPicker(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !selectedMaster) return;
    setSaving(true);
    try {
      const docId = editId || doc(collection(db, `projects/${id}/items`)).id;
      const valorTotal = (selectedMaster.valorUnitario || 0) * (formData.quantidade || 0);

      const payload: Partial<ItemProjeto> = {
        ...formData,
        id: docId,
        projectId: id,
        itemId: selectedMaster.id,
        nome: selectedMaster.nome,
        descricao: selectedMaster.descricao || '',
        unidade: selectedMaster.unidade,
        valorUnitario: selectedMaster.valorUnitario,
        valorTotal,
        criadoEm: formData.criadoEm || serverTimestamp() as Timestamp
      };

      await setDoc(doc(db, `projects/${id}/items`, docId), payload as any, { merge: true });
      
      setIsFormOpen(false);
      carregarDados();
    } catch (e) {
      console.error(e);
      alert("Erro ao vincular item");
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || selectedMasters.length === 0) return;
    setSaving(true);
    try {
      const batch = writeBatch(db);

      for (const m of selectedMasters) {
        const data = batchData[m.id] || { memorialCalculo: '', quantidade: 1, moduloId: '' };
        const docId = doc(collection(db, `projects/${id}/items`)).id;
        const valorTotal = (m.valorUnitario || 0) * (data.quantidade || 0);

        const payload: Partial<ItemProjeto> = {
          id: docId,
          projectId: id,
          itemId: m.id,
          moduloId: data.moduloId,
          nome: m.nome,
          descricao: m.descricao || '',
          unidade: m.unidade,
          valorUnitario: m.valorUnitario,
          memorialCalculo: data.memorialCalculo,
          quantidade: data.quantidade,
          valorTotal,
          criadoEm: serverTimestamp() as Timestamp
        };

        batch.set(doc(db, `projects/${id}/items`, docId), payload);
      }

      await batch.commit();
      
      setIsFormOpen(false);
      carregarDados();
    } catch (e) {
      console.error(e);
      alert("Erro ao vincular itens em lote: " + (e instanceof Error ? e.message : 'Erro desconhecido'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (itemId: string) => {
    if (!confirm("Remover este item do projeto? (O item continuará no Banco de Dados geral)")) return;
    try {
      await deleteDoc(doc(db, `projects/${id}/items`, itemId));
      setItensProjeto(prev => prev.filter(it => it.id !== itemId));
    } catch (e) {
      console.error(e);
    }
  };

  const filteredMaster = itensMaster.filter(m => 
    m.nome.toLowerCase().includes(pickerSearch.toLowerCase()) || 
    m.codigo.toString().includes(pickerSearch)
  );

  const totalProjeto = itensProjeto.reduce((acc, it) => acc + (it.valorTotal || 0), 0);

  if (loading) return <div className="p-6 text-lie-gray">Carregando itens do projeto...</div>;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate(`/projetos/${id}`)} className="p-2 text-lie-gray hover:bg-gray-100 rounded-lg transition">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-lie-ink">Itens do Projeto</h1>
            <p className="text-sm text-lie-gray">{projeto?.titulo}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={openNewModulo}
            className="group flex items-center bg-white border border-gray-300 text-lie-ink rounded-lg p-2 transition-all duration-300 overflow-hidden hover:bg-gray-50 shadow-sm"
          >
            <Folder className="w-5 h-5 shrink-0" />
            <span className="max-w-0 opacity-0 group-hover:max-w-xs group-hover:opacity-100 group-hover:ml-2 whitespace-nowrap transition-all duration-300 ease-in-out font-medium">
              Módulos
            </span>
          </button>
          <button 
            onClick={exportToExcel} 
            disabled={itensProjeto.length === 0}
            className="group flex items-center bg-white border border-gray-300 text-green-700 rounded-lg p-2 transition-all duration-300 overflow-hidden hover:bg-green-50 shadow-sm disabled:opacity-50"
          >
            <FileSpreadsheet className="w-5 h-5 shrink-0" />
            <span className="max-w-0 opacity-0 group-hover:max-w-xs group-hover:opacity-100 group-hover:ml-2 whitespace-nowrap transition-all duration-300 ease-in-out font-medium">
              Planilha Excel
            </span>
          </button>
          <button 
            onClick={openNew} 
            className="group flex items-center bg-lie-green text-white rounded-lg p-2 transition-all duration-300 overflow-hidden hover:bg-lie-greenDark shadow-sm"
          >
            <Plus className="w-5 h-5 shrink-0" />
            <span className="max-w-0 opacity-0 group-hover:max-w-xs group-hover:opacity-100 group-hover:ml-2 whitespace-nowrap transition-all duration-300 ease-in-out font-medium">
              Vincular Item
            </span>
          </button>
        </div>
      </header>

      {isModuloFormOpen && (
        <div className="bg-white rounded-xl shadow-premium p-6 border border-gray-100 mb-6 animate-fade-in relative font-sans">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-bold text-lie-ink">{editModuloId ? 'Editar Módulo' : 'Novo Módulo'}</h2>
            {!editModuloId && (
              <button 
                onClick={openImportModal}
                className="text-sm flex items-center gap-1 text-blue-600 hover:text-blue-800 font-bold bg-blue-50 px-3 py-1.5 rounded-lg transition-colors"
              >
                <Download className="w-4 h-4" />
                Importar de outro projeto
              </button>
            )}
          </div>
          
          {isImportModalOpen && (
            <div className="mb-6 p-4 bg-blue-50 rounded-lg border border-blue-100 animate-fade-in">
              <h3 className="font-bold text-blue-900 mb-3 flex items-center gap-2">
                <Download className="w-4 h-4" /> Importar Módulo Existente
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-xs font-bold text-blue-800 mb-1">Selecione o Projeto Origem</label>
                  <select 
                    value={selectedImportProject} 
                    onChange={e => handleSelectImportProject(e.target.value)}
                    className="w-full text-sm border-blue-200 rounded-lg shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  >
                    <option value="">-- Escolha --</option>
                    {importProjects.map(p => <option key={p.id} value={p.id}>{p.titulo}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-blue-800 mb-1">Selecione o Módulo</label>
                  <select 
                    value={selectedImportModulo} 
                    onChange={e => setSelectedImportModulo(e.target.value)}
                    disabled={!selectedImportProject}
                    className="w-full text-sm border-blue-200 rounded-lg shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  >
                    <option value="">-- Escolha --</option>
                    {importModulos.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setIsImportModalOpen(false)} className="px-3 py-1.5 text-sm text-blue-700 hover:bg-blue-100 rounded-lg font-medium">Cancelar Importação</button>
                <button 
                  type="button" 
                  onClick={handleConfirmImport}
                  disabled={!selectedImportProject || !selectedImportModulo || importing} 
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-lg text-sm font-bold shadow-sm flex items-center gap-2 disabled:opacity-50"
                >
                  {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {importing ? 'Importando...' : 'Confirmar Importação'}
                </button>
              </div>
            </div>
          )}

          <form onSubmit={handleModuloSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Nome do Módulo *</label>
                <input required value={moduloFormData.nome || ''} onChange={e => setModuloFormData(p => ({...p, nome: e.target.value}))} className="w-full border-gray-300 rounded-lg shadow-sm" />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Descrição</label>
                <input value={moduloFormData.descricao || ''} onChange={e => setModuloFormData(p => ({...p, descricao: e.target.value}))} className="w-full border-gray-300 rounded-lg shadow-sm" />
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
              <button type="button" onClick={() => setIsModuloFormOpen(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium">Cancelar</button>
              <button type="submit" disabled={savingModulo} className="bg-lie-green hover:bg-lie-greenDark text-white px-8 py-2 rounded-lg font-bold shadow-sm flex items-center gap-2">
                {savingModulo ? 'Salvando...' : 'Salvar Módulo'}
              </button>
            </div>
          </form>
          {modulos.length > 0 && (
            <div className="mt-6">
              <h3 className="font-bold text-sm mb-2 text-gray-700">Módulos Existentes</h3>
              <ul className="divide-y border rounded-lg">
                {modulos.map(m => (
                  <li key={m.id} className="p-3 flex justify-between items-center hover:bg-gray-50">
                    <div>
                      <div className="font-bold text-sm">{m.nome}</div>
                      <div className="text-xs text-gray-500">{m.descricao}</div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => openEditModulo(m)} className="p-1 text-lie-ink hover:bg-gray-200 rounded"><Edit3 className="w-4 h-4" /></button>
                      <button onClick={() => handleDeleteModulo(m.id)} className="p-1 text-red-500 hover:bg-red-50 rounded"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {isFormOpen && (
        <div className="bg-white rounded-xl shadow-premium p-6 border border-gray-100 mb-6 animate-fade-in relative font-sans">
          <h2 className="text-lg font-bold text-lie-ink mb-4">
            {editId ? 'Editar Item no Projeto' : 'Vincular Itens em Lote'}
          </h2>
          
          {showItemPicker ? (
            <div className="space-y-4">
              <label className="block text-sm font-bold text-gray-700">1. Busque e selecione os itens no Banco de Dados Geral</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input 
                  type="text" 
                  autoFocus
                  placeholder="Nome ou código do item..." 
                  className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm"
                  value={pickerSearch}
                  onChange={e => setPickerSearch(e.target.value)}
                />
              </div>
              <div className="max-h-60 overflow-y-auto border border-gray-100 rounded-lg divide-y">
                {filteredMaster.map(m => {
                  const isSelected = selectedMasters.some(x => x.id === m.id);
                  return (
                    <div 
                      key={m.id} 
                      onClick={() => toggleMasterSelection(m)}
                      className={`p-3 hover:bg-gray-50 cursor-pointer flex items-center justify-between group transition-colors ${isSelected ? 'bg-lie-green/5' : ''}`}
                    >
                      <div className="flex items-center gap-3 flex-1">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}} // toggleMasterSelection já é chamado pelo onClick do container pai
                          className="rounded border-gray-300 text-lie-green focus:ring-lie-green w-4 h-4 shrink-0 pointer-events-none"
                        />
                        <div>
                          <div className="font-bold text-sm text-lie-ink">{m.nome}</div>
                          <div className="text-[10px] text-gray-500 uppercase tracking-tight font-bold">{m.categoria} • #{m.codigo} • {m.unidade}</div>
                        </div>
                      </div>
                      <div className="text-right ml-4 shrink-0">
                        <div className="text-xs font-bold text-lie-green">
                          {m.valorUnitario.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                        </div>
                        <span className="text-[10px] text-gray-400 group-hover:text-lie-green">
                          {isSelected ? 'Selecionado' : 'Clique para selecionar'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between items-center pt-2">
                <button type="button" onClick={() => setIsFormOpen(false)} className="text-sm text-gray-500 hover:underline">Cancelar</button>
                <button
                  type="button"
                  disabled={selectedMasters.length === 0}
                  onClick={avancarLote}
                  className="bg-lie-green hover:bg-lie-greenDark text-white px-5 py-2 rounded-lg font-bold text-sm shadow-sm disabled:opacity-50 transition"
                >
                  Avançar ({selectedMasters.length} selecionados)
                </button>
              </div>
            </div>
          ) : editId ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              {selectedMaster && (
                <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 flex items-center justify-between mb-2">
                  <div>
                    <span className="text-[10px] font-bold text-lie-green uppercase">Item Selecionado</span>
                    <h3 className="font-bold text-lie-ink">{selectedMaster.nome}</h3>
                    <p className="text-xs text-gray-500">{selectedMaster.unidade} • {selectedMaster.valorUnitario.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-3">
                  <label className="block text-sm font-bold text-gray-700 mb-1">Módulo</label>
                  <select value={formData.moduloId || ''} onChange={e => setFormData(p => ({...p, moduloId: e.target.value}))} className="w-full border-gray-300 rounded-lg shadow-sm">
                    <option value="">Sem módulo</option>
                    {modulos.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
                  </select>
                </div>
                <div className="lg:col-span-2 md:col-span-2">
                  <label className="block text-sm font-bold text-gray-700 mb-1">Memorial de Cálculo *</label>
                  <textarea 
                    required 
                    rows={2} 
                    placeholder="Ex: 10 alunos x 5 dias x R$ 2,50"
                    value={formData.memorialCalculo} 
                    onChange={e => setFormData(p => ({...p, memorialCalculo: e.target.value}))} 
                    className="w-full border-gray-300 rounded-lg shadow-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">Quantidade Total *</label>
                  <input 
                    type="number" 
                    step="0.01" 
                    required 
                    value={formData.quantidade} 
                    onChange={e => setFormData(p => ({...p, quantidade: parseFloat(e.target.value) || 0}))} 
                    className="w-full border-gray-300 rounded-lg shadow-sm" 
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">Total do Item (Auto)</label>
                  <div className="px-4 py-2 bg-gray-100 rounded-lg font-bold text-lie-ink">
                    {((selectedMaster?.valorUnitario || 0) * (formData.quantidade || 0)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                <button type="button" onClick={() => setIsFormOpen(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium">Cancelar</button>
                <button type="submit" disabled={saving} className="bg-lie-green hover:bg-lie-greenDark text-white px-8 py-2 rounded-lg font-bold shadow-sm flex items-center gap-2">
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  {saving ? 'Vinculando...' : 'Salvar Alterações'}
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleSubmitBatch} className="space-y-6">
              <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 flex items-center justify-between mb-4">
                <div>
                  <span className="text-[10px] font-bold text-lie-green uppercase">Itens Selecionados em Lote</span>
                  <h3 className="font-bold text-lie-ink">{selectedMasters.length} itens do Banco de Dados Geral</h3>
                </div>
                <button type="button" onClick={() => setShowItemPicker(true)} className="text-xs text-blue-600 hover:underline font-semibold">Adicionar/Trocar Itens</button>
              </div>

              <div className="space-y-6 divide-y divide-gray-100 max-h-[50vh] overflow-y-auto pr-2">
                {selectedMasters.map((m, idx) => {
                  const data = batchData[m.id] || { memorialCalculo: '', quantidade: 1, moduloId: '' };
                  const updateField = (field: 'memorialCalculo' | 'quantidade' | 'moduloId', val: any) => {
                    setBatchData(prev => ({
                      ...prev,
                      [m.id]: {
                        ...prev[m.id],
                        [field]: val
                      }
                    }));
                  };

                  return (
                    <div key={m.id} className={`pt-4 ${idx === 0 ? 'pt-0' : ''} space-y-3`}>
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-[10px] text-gray-400 font-mono">#{m.codigo} • {m.unidade}</span>
                          <h4 className="font-bold text-lie-ink text-sm">{m.nome}</h4>
                          <span className="text-[10px] text-gray-500 uppercase tracking-tight font-bold">{m.categoria} • Preço Unitário: {m.valorUnitario.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedMasters(prev => prev.filter(x => x.id !== m.id));
                            setBatchData(prev => {
                              const copy = { ...prev };
                              delete copy[m.id];
                              return copy;
                            });
                          }}
                          className="text-xs text-red-500 hover:underline font-semibold"
                          title="Remover este item do lote"
                        >
                          Remover
                        </button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div>
                          <label className="block text-xs font-semibold text-gray-600 mb-1">Módulo</label>
                          <select value={data.moduloId || ''} onChange={e => updateField('moduloId', e.target.value)} className="w-full border border-gray-300 rounded-lg shadow-sm text-sm">
                            <option value="">Sem módulo</option>
                            {modulos.map(mo => <option key={mo.id} value={mo.id}>{mo.nome}</option>)}
                          </select>
                        </div>
                        <div className="md:col-span-2">
                          <label className="block text-xs font-semibold text-gray-600 mb-1">Memorial de Cálculo *</label>
                          <textarea
                            required
                            rows={1}
                            placeholder="Ex: 10 alunos x 5 dias x R$ 2,50"
                            value={data.memorialCalculo}
                            onChange={e => updateField('memorialCalculo', e.target.value)}
                            className="w-full border border-gray-300 rounded-lg shadow-sm text-sm"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-1">Qtd. *</label>
                            <input
                              type="number"
                              step="0.01"
                              required
                              value={data.quantidade}
                              onChange={e => updateField('quantidade', parseFloat(e.target.value) || 0)}
                              className="w-full border border-gray-300 rounded-lg shadow-sm text-sm font-bold"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-1">Total (Auto)</label>
                            <div className="px-2 py-2 bg-gray-100 rounded-lg font-bold text-xs text-lie-ink text-center h-[38px] flex items-center justify-center">
                              {((m.valorUnitario || 0) * (data.quantidade || 0)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {selectedMasters.length === 0 && (
                <div className="p-6 text-center text-lie-gray italic border border-dashed rounded-lg">Nenhum item restou no lote. Por favor, adicione itens.</div>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                <button type="button" onClick={() => setIsFormOpen(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium">Cancelar</button>
                <button type="submit" disabled={saving || selectedMasters.length === 0} className="bg-lie-green hover:bg-lie-greenDark text-white px-8 py-2 rounded-lg font-bold shadow-sm flex items-center gap-2">
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  {saving ? 'Vinculando...' : `Confirmar Vínculo de ${selectedMasters.length} Itens`}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-premium overflow-hidden border border-gray-100">
        <table className="w-full text-left">
          <thead className="bg-gray-50 text-xs font-bold text-lie-gray uppercase border-b border-gray-200">
            <tr>
              <th className="px-4 py-3">Item / Especificação</th>
              <th className="px-4 py-3">Memorial de Cálculo</th>
              <th className="px-4 py-3 w-20 text-center">Und.</th>
              <th className="px-4 py-3 w-20 text-center">Qtd.</th>
              <th className="px-4 py-3 w-28 text-right">$ Unitário</th>
              <th className="px-4 py-3 w-32 text-right">$ Total</th>
              <th className="px-4 py-3 w-24 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {modulos.map(modulo => {
              const itensDoModulo = itensProjeto.filter(it => it.moduloId === modulo.id);
              if (itensDoModulo.length === 0) return null;
              return (
                <React.Fragment key={modulo.id}>
                  <tr className="bg-gray-200 border-y-2 border-gray-300">
                    <td colSpan={7} className="px-4 py-3 font-black text-lie-ink uppercase tracking-wide text-xs">
                      <div className="flex items-center gap-2">
                        <Folder className="w-4 h-4 text-lie-green" />
                        {modulo.nome}
                      </div>
                    </td>
                  </tr>
                  {itensDoModulo.map(it => (
                    <tr key={it.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-bold text-lie-ink">{it.nome}</div>
                        <div className="text-[10px] text-gray-500 uppercase font-bold">#{itensMaster.find(m => m.id === it.itemId)?.codigo}</div>
                        {it.descricao && <div className="text-[10px] text-gray-400 line-clamp-1">{it.descricao}</div>}
                        {it.pesquisado ? (
                          <div className="flex items-center gap-1 mt-1 text-[9px] font-bold text-lie-green uppercase tracking-wide">
                            <Check className="w-3 h-3 text-lie-green" />
                            Pesquisado (Ref: {it.medianaReferencia?.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) || 'R$ 0,00'})
                          </div>
                        ) : (
                          <div className="text-[9px] font-bold text-amber-500 uppercase tracking-wide mt-1 flex items-center gap-1">
                            <span>⚠️ Preço não pesquisado (IN 65/2021)</span>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 italic">{it.memorialCalculo}</td>
                      <td className="px-4 py-3 text-sm text-center">{it.unidade}</td>
                      <td className="px-4 py-3 text-sm text-center font-bold">{it.quantidade}</td>
                      <td className="px-4 py-3 text-sm text-right text-gray-500">{it.valorUnitario.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                      <td className="px-4 py-3 text-sm font-bold text-right text-lie-ink">{it.valorTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => { setSelectedItemForPesquisa(it); setIsPesquisaOpen(true); }} className={`p-1.5 rounded transition ${it.pesquisado ? 'text-lie-green hover:bg-lie-green/10' : 'text-amber-500 hover:bg-amber-50'}`} title="Pesquisa de Preços Públicos">
                            <Scale className="w-4 h-4" />
                          </button>
                          <button onClick={() => openEdit(it)} className="p-1.5 text-lie-ink hover:bg-gray-100 rounded transition" title="Editar"><Edit3 className="w-4 h-4" /></button>
                          <button onClick={() => handleDelete(it.id)} className="p-1.5 text-red-500 hover:bg-red-50 rounded transition" title="Excluir"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-gray-50 border-t border-gray-200">
                    <td colSpan={5} className="px-4 py-2 text-right font-bold text-gray-500 text-xs">Subtotal Módulo:</td>
                    <td className="px-4 py-2 text-right font-bold text-lie-ink">
                      {itensDoModulo.reduce((acc, curr) => acc + (curr.valorTotal || 0), 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </td>
                    <td></td>
                  </tr>
                </React.Fragment>
              );
            })}

            {/* Itens Sem Módulo */}
            {(() => {
              const semModulo = itensProjeto.filter(it => !it.moduloId);
              if (semModulo.length === 0) return null;
              return (
                <React.Fragment key="sem-modulo">
                  {modulos.length > 0 && (
                    <tr className="bg-gray-100 border-y-2 border-gray-200">
                      <td colSpan={7} className="px-4 py-3 font-bold text-gray-500 uppercase tracking-wide text-xs">Itens sem Módulo</td>
                    </tr>
                  )}
                  {semModulo.map(it => (
                    <tr key={it.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-bold text-lie-ink">{it.nome}</div>
                        <div className="text-[10px] text-gray-500 uppercase font-bold">#{itensMaster.find(m => m.id === it.itemId)?.codigo}</div>
                        {it.descricao && <div className="text-[10px] text-gray-400 line-clamp-1">{it.descricao}</div>}
                        {it.pesquisado ? (
                          <div className="flex items-center gap-1 mt-1 text-[9px] font-bold text-lie-green uppercase tracking-wide">
                            <Check className="w-3 h-3 text-lie-green" />
                            Pesquisado (Ref: {it.medianaReferencia?.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) || 'R$ 0,00'})
                          </div>
                        ) : (
                          <div className="text-[9px] font-bold text-amber-500 uppercase tracking-wide mt-1 flex items-center gap-1">
                            <span>⚠️ Preço não pesquisado (IN 65/2021)</span>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 italic">{it.memorialCalculo}</td>
                      <td className="px-4 py-3 text-sm text-center">{it.unidade}</td>
                      <td className="px-4 py-3 text-sm text-center font-bold">{it.quantidade}</td>
                      <td className="px-4 py-3 text-sm text-right text-gray-500">{it.valorUnitario.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                      <td className="px-4 py-3 text-sm font-bold text-right text-lie-ink">{it.valorTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => { setSelectedItemForPesquisa(it); setIsPesquisaOpen(true); }} className={`p-1.5 rounded transition ${it.pesquisado ? 'text-lie-green hover:bg-lie-green/10' : 'text-amber-500 hover:bg-amber-50'}`} title="Pesquisa de Preços Públicos">
                            <Scale className="w-4 h-4" />
                          </button>
                          <button onClick={() => openEdit(it)} className="p-1.5 text-lie-ink hover:bg-gray-100 rounded transition" title="Editar"><Edit3 className="w-4 h-4" /></button>
                          <button onClick={() => handleDelete(it.id)} className="p-1.5 text-red-500 hover:bg-red-50 rounded transition" title="Excluir"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {modulos.length > 0 && (
                    <tr className="bg-gray-50 border-t border-gray-200">
                      <td colSpan={5} className="px-4 py-2 text-right font-bold text-gray-500 text-xs">Subtotal Sem Módulo:</td>
                      <td className="px-4 py-2 text-right font-bold text-lie-ink">
                        {semModulo.reduce((acc, curr) => acc + (curr.valorTotal || 0), 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                      </td>
                      <td></td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })()}
          </tbody>
          <tfoot className="bg-gray-50 border-t-2 border-gray-200">
            <tr>
              <td colSpan={5} className="px-4 py-4 text-right font-bold text-lie-ink uppercase text-xs">Total do Projeto:</td>
              <td className="px-4 py-4 text-right font-black text-lie-green text-lg">
                {totalProjeto.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
              </td>
              <td></td>
            </tr>
          </tfoot>
        </table>
        {itensProjeto.length === 0 && (
          <div className="p-12 text-center text-lie-gray italic">Nenhum item vinculado a este projeto ainda.</div>
        )}
      </div>

      {selectedItemForPesquisa && (
        <PesquisaPrecoModal
          isOpen={isPesquisaOpen}
          onClose={() => {
            setIsPesquisaOpen(false);
            setSelectedItemForPesquisa(null);
          }}
          item={selectedItemForPesquisa}
          projetoTitulo={projeto?.titulo}
          entidadeNome={projeto?.entidadeSigla || "Entidade"}
          onSave={() => carregarDados()}
        />
      )}
    </div>
  );
}
