import { useEffect, useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { collection, query, getDocs, doc, getDoc, setDoc, deleteDoc, serverTimestamp, Timestamp, orderBy, writeBatch } from 'firebase/firestore';
import { ArrowLeft, Plus, Search, Trash2, Edit3, Loader2, Calculator, Package, Check, FileSpreadsheet, Scale, ShieldCheck, Eye, Sparkles, X, CheckCircle2, AlertCircle } from 'lucide-react';
import { db } from '../lib/firebase';
import * as XLSX from 'xlsx';
import type { ItemMaster, ItemProjeto, Projeto } from '../types';
import PesquisaPrecoModal from '../components/PesquisaPrecoModal';
import { pesquisarItemAutomatico, type AutoPesquisaResult } from '../lib/pesquisaAutomatica';

export default function ProjetoItensPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [projeto, setProjeto] = useState<Projeto | null>(null);
  const [itensProjeto, setItensProjeto] = useState<ItemProjeto[]>([]);
  const [itensMaster, setItensMaster] = useState<ItemMaster[]>([]);
  const [loading, setLoading] = useState(true);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  
  // Estados para seleção do item base
  const [showItemPicker, setShowItemPicker] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [selectedMaster, setSelectedMaster] = useState<ItemMaster | null>(null);

  // Estados para inclusão em lote
  const [selectedMasters, setSelectedMasters] = useState<ItemMaster[]>([]);
  const [batchData, setBatchData] = useState<Record<string, { memorialCalculo: string; quantidade: number }>>({});

  const [formData, setFormData] = useState<Partial<ItemProjeto>>({
    memorialCalculo: '',
    quantidade: 1,
  });

  // Estados para pesquisa de preços públicos (IN 65/2021)
  const [isPesquisaOpen, setIsPesquisaOpen] = useState(false);
  const [selectedItemForPesquisa, setSelectedItemForPesquisa] = useState<ItemProjeto | null>(null);

  // Estados para pesquisa automática em lote
  const [batchPesquisaOpen, setBatchPesquisaOpen] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0, current: '' });
  const [batchResults, setBatchResults] = useState<AutoPesquisaResult[]>([]);

  const [entidadeNome, setEntidadeNome] = useState<string>('');

  const carregarDados = async () => {
    if (!id) return;
    try {
      setLoading(true);
      
      // Projeto
      const projSnap = await getDoc(doc(db, 'projects', id));
      if (projSnap.exists()) {
        const projData = { id: projSnap.id, ...projSnap.data() } as Projeto;
        setProjeto(projData);
        if (projData.entidadeId) {
          const entSnap = await getDoc(doc(db, 'entities', projData.entidadeId));
          if (entSnap.exists()) setEntidadeNome((entSnap.data() as any).nome || '');
        }
      }

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

    // Cabeçalhos claros e organizados
    const headers = [
      'Nº',
      'Item',
      'Descrição',
      'Memorial de Cálculo',
      'Unidade',
      'Quantidade',
      'Valor Unitário (R$)',
      'Valor Total (R$)'
    ];

    // Mapeamento das linhas
    const rows = itensProjeto.map(it => {
      const master = itensMaster.find(m => m.id === it.itemId);
      return [
        master ? String(master.codigo).padStart(3, '0') : '-',
        it.nome,
        it.descricao || '-',
        it.memorialCalculo,
        it.unidade,
        it.quantidade,
        it.valorUnitario,
        it.valorTotal
      ];
    });

    // Linha de Totalizador no final
    const totalRow = [
      '',
      'TOTAL DO PROJETO',
      '',
      '',
      '',
      '',
      '',
      totalProjeto
    ];

    const fileData = [headers, ...rows, totalRow];
    const worksheet = XLSX.utils.aoa_to_sheet(fileData);

    // Formatação de Células: Quantidade (coluna E / índice 5), Unitário (coluna F / índice 6), Total (coluna G / índice 7)
    const totalRowsCount = fileData.length;
    for (let r = 1; r < totalRowsCount; r++) {
      // Quantidade
      const cellQtdRef = XLSX.utils.encode_cell({ r, c: 5 });
      const cellQtd = worksheet[cellQtdRef];
      if (cellQtd && typeof cellQtd.v === 'number') {
        cellQtd.z = '#,##0.00';
      }

      // Valor Unitário
      const cellUnitRef = XLSX.utils.encode_cell({ r, c: 6 });
      const cellUnit = worksheet[cellUnitRef];
      if (cellUnit && typeof cellUnit.v === 'number') {
        cellUnit.z = '"R$ "#,##0.00';
      }

      // Valor Total
      const cellTotalRef = XLSX.utils.encode_cell({ r, c: 7 });
      const cellTotal = worksheet[cellTotalRef];
      if (cellTotal && typeof cellTotal.v === 'number') {
        cellTotal.z = '"R$ "#,##0.00';
      }
    }

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Itens do Projeto');

    // Auto-ajuste de colunas baseado no tamanho do conteúdo (usando wch padrão do SheetJS)
    const maxWidths: number[] = fileData.reduce((acc: number[], row) => {
      row.forEach((val, i) => {
        let strVal = '';
        if (typeof val === 'number') {
          if (i === 6 || i === 7) {
            strVal = val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
          } else {
            strVal = String(val);
          }
        } else {
          strVal = String(val || '');
        }
        acc[i] = Math.max(Number(acc[i] || 0), strVal.length);
      });
      return acc;
    }, [] as number[]);
    worksheet['!cols'] = maxWidths.map((w: any) => ({ wch: Number(w) + 3 }));

    // Geração do arquivo e download via Blob nativo usando método clássico s2ab (Garante 100% de integridade)
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
      a.download = `itens_projeto_${projeto?.titulo || 'lie'}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Erro ao gerar/baixar Excel:", err);
      alert("Erro ao gerar a planilha. Tentando método simplificado...");
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
    const initialBatch: Record<string, { memorialCalculo: string; quantidade: number }> = {};
    selectedMasters.forEach(m => {
      initialBatch[m.id] = batchData[m.id] || { memorialCalculo: '', quantidade: 1 };
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
        // Propaga CATMAT/CATSER oficial do master pra pesquisa automática
        codigoCatmat: selectedMaster.codigoCatmat,
        tipoCatmat: selectedMaster.tipoCatmat,
        nomeCatmatOficial: selectedMaster.nomeCatmatOficial,
        descricaoCatmatOficial: selectedMaster.descricaoCatmatOficial,
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
        const data = batchData[m.id] || { memorialCalculo: '', quantidade: 1 };
        const docId = doc(collection(db, `projects/${id}/items`)).id;
        const valorTotal = (m.valorUnitario || 0) * (data.quantidade || 0);

        const payload: Partial<ItemProjeto> = {
          id: docId,
          projectId: id,
          itemId: m.id,
          nome: m.nome,
          descricao: m.descricao || '',
          unidade: m.unidade,
          valorUnitario: m.valorUnitario,
          memorialCalculo: data.memorialCalculo,
          quantidade: data.quantidade,
          valorTotal,
          // Propaga CATMAT/CATSER oficial do master pra pesquisa automática
          codigoCatmat: m.codigoCatmat,
          tipoCatmat: m.tipoCatmat,
          nomeCatmatOficial: m.nomeCatmatOficial,
          descricaoCatmatOficial: m.descricaoCatmatOficial,
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

  const startBatchPesquisa = async () => {
    if (!projeto) return;
    setBatchRunning(true);
    setBatchResults([]);
    setBatchProgress({ done: 0, total: itensProjeto.length, current: '' });

    const results: AutoPesquisaResult[] = [];
    for (let i = 0; i < itensProjeto.length; i++) {
      const item = itensProjeto[i];
      setBatchProgress({ done: i, total: itensProjeto.length, current: item.nome });
      const res = await pesquisarItemAutomatico(item, projeto.titulo, entidadeNome);
      results.push(res);
      setBatchResults([...results]);
    }

    setBatchProgress({ done: itensProjeto.length, total: itensProjeto.length, current: '' });
    setBatchRunning(false);
    await carregarDados();
  };

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
            onClick={() => setBatchPesquisaOpen(true)}
            disabled={itensProjeto.length === 0}
            title="Pesquisa Automática de Preços (IN 65/2021)"
            className="group flex items-center bg-white border border-amber-300 text-amber-700 rounded-lg p-2 transition-all duration-300 overflow-hidden hover:bg-amber-50 shadow-sm disabled:opacity-50"
          >
            <Sparkles className="w-5 h-5 shrink-0" />
            <span className="max-w-0 opacity-0 group-hover:max-w-xs group-hover:opacity-100 group-hover:ml-2 whitespace-nowrap transition-all duration-300 ease-in-out font-medium">
              Pesquisar Tudo
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

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
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
                  const data = batchData[m.id] || { memorialCalculo: '', quantidade: 1 };
                  const updateField = (field: 'memorialCalculo' | 'quantidade', val: any) => {
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

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
            {itensProjeto.map(it => (
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
                <td className="px-4 py-3 text-sm text-gray-600 italic">
                  {it.memorialCalculo}
                </td>
                <td className="px-4 py-3 text-sm text-center">{it.unidade}</td>
                <td className="px-4 py-3 text-sm text-center font-bold">{it.quantidade}</td>
                <td className="px-4 py-3 text-sm text-right text-gray-500">
                  {it.valorUnitario.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </td>
                <td className="px-4 py-3 text-sm font-bold text-right text-lie-ink">
                  {it.valorTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button 
                      onClick={() => {
                        setSelectedItemForPesquisa(it);
                        setIsPesquisaOpen(true);
                      }} 
                      className={`p-1.5 rounded transition ${it.pesquisado ? 'text-lie-green hover:bg-lie-green/10' : 'text-amber-500 hover:bg-amber-50'}`} 
                      title="Pesquisa de Preços Públicos (IN 65/2021)"
                    >
                      <Scale className="w-4 h-4" />
                    </button>
                    {it.pesquisado && (
                      <a 
                        href={`/#/validar?token=${it.tokenPesquisa}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 text-blue-500 hover:bg-blue-50 rounded transition flex items-center justify-center" 
                        title="Visualizar Detalhes e Certificado da Pesquisa"
                      >
                        <Eye className="w-4 h-4" />
                      </a>
                    )}
                    <button onClick={() => openEdit(it)} className="p-1.5 text-lie-ink hover:bg-gray-100 rounded transition" title="Editar">
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button onClick={() => handleDelete(it.id)} className="p-1.5 text-red-500 hover:bg-red-50 rounded transition" title="Excluir">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
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

      {batchPesquisaOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[88vh] animate-zoom-in">
            <header className="bg-lie-ink p-4 flex items-center justify-between text-white">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-500 rounded-lg">
                  <Sparkles className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="font-bold">Pesquisa Automática de Preços</h3>
                  <p className="text-xs text-gray-300">
                    {batchRunning
                      ? `Processando ${batchProgress.done + 1} de ${batchProgress.total} — ${batchProgress.current}`
                      : batchResults.length > 0
                        ? `Concluído: ${batchResults.length} item(ns) processado(s)`
                        : `${itensProjeto.length} item(ns) serão pesquisados sequencialmente (IN 65/2021)`
                    }
                  </p>
                </div>
              </div>
              {!batchRunning && (
                <button
                  onClick={() => { setBatchPesquisaOpen(false); setBatchResults([]); }}
                  className="hover:bg-white/10 p-2 rounded-full transition"
                >
                  <X className="w-5 h-5" />
                </button>
              )}
            </header>

            <div className="p-6 overflow-y-auto flex-1 space-y-4">
              {batchRunning && (
                <div className="space-y-2">
                  <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-amber-500 h-full transition-all duration-300"
                      style={{ width: `${(batchProgress.done / batchProgress.total) * 100}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-500 flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Buscando catálogo CATMAT/CATSER, consultando Compras.gov.br/PNCP e arquivando comprovantes…
                  </p>
                </div>
              )}

              {!batchRunning && batchResults.length === 0 && (
                <div className="text-sm text-gray-600 space-y-3 leading-relaxed">
                  <p>
                    A pesquisa automática executa, pra cada item do projeto, o mesmo fluxo da
                    pesquisa individual: busca no catálogo público, consulta de preços praticados
                    e auto-seleção de referências <strong>iguais ou superiores</strong> ao valor estimado.
                  </p>
                  <p>
                    Os itens já pesquisados serão <strong>reprocessados</strong> e suas cestas atualizadas.
                    Cada referência gera um comprovante PDF arquivado no Storage.
                  </p>
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
                    <strong>Tempo estimado:</strong> aproximadamente 10–60 segundos por item, dependendo
                    da quantidade de cotações encontradas e da resposta da API governamental.
                  </p>
                </div>
              )}

              {batchResults.length > 0 && (
                <div className="space-y-2 max-h-[40vh] overflow-y-auto">
                  {batchResults.map((r, idx) => (
                    <div
                      key={idx}
                      className={`flex items-start gap-2 p-2.5 rounded-lg border text-xs ${
                        r.status === 'ok' ? 'bg-green-50 border-green-200' :
                        r.status === 'sem-catmat-real' ? 'bg-orange-50 border-orange-200' :
                        r.status === 'sem-match' ? 'bg-gray-50 border-gray-200' :
                        r.status === 'sem-refs' ? 'bg-amber-50 border-amber-200' :
                        'bg-red-50 border-red-200'
                      }`}
                    >
                      {r.status === 'ok' && <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />}
                      {r.status === 'sem-catmat-real' && <AlertCircle className="w-4 h-4 text-orange-600 shrink-0 mt-0.5" />}
                      {r.status === 'sem-match' && <AlertCircle className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />}
                      {r.status === 'sem-refs' && <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />}
                      {r.status === 'erro' && <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />}
                      <div className="flex-1">
                        <div className="font-bold text-gray-800">{r.itemNome}</div>
                        <div className="text-gray-600 mt-0.5">
                          {r.status === 'ok' && `${r.refsCount} referência(s) homologada(s).`}
                          {r.status !== 'ok' && r.reason}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-4 bg-gray-50 flex gap-3 border-t shrink-0">
              {!batchRunning && batchResults.length === 0 && (
                <>
                  <button
                    onClick={() => setBatchPesquisaOpen(false)}
                    className="flex-1 py-2 font-bold text-gray-500 hover:bg-gray-100 rounded-lg transition"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={startBatchPesquisa}
                    className="flex-1 py-2 bg-amber-500 text-white font-bold rounded-lg hover:bg-amber-600 transition flex items-center justify-center gap-2"
                  >
                    <Sparkles className="w-4 h-4" />
                    Pesquisar {itensProjeto.length} item(ns)
                  </button>
                </>
              )}
              {batchRunning && (
                <div className="flex-1 text-center text-sm text-gray-500 italic">
                  Aguarde — a janela fechará após a conclusão de todos os itens.
                </div>
              )}
              {!batchRunning && batchResults.length > 0 && (
                <button
                  onClick={() => { setBatchPesquisaOpen(false); setBatchResults([]); }}
                  className="flex-1 py-2 bg-lie-green text-white font-bold rounded-lg hover:bg-lie-greenDark transition"
                >
                  Fechar
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
