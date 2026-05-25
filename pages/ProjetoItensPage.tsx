import { useEffect, useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { collection, query, getDocs, doc, getDoc, setDoc, deleteDoc, serverTimestamp, Timestamp, orderBy } from 'firebase/firestore';
import { ArrowLeft, Plus, Search, Trash2, Edit3, Loader2, Calculator, Package, Check, FileSpreadsheet } from 'lucide-react';
import { db } from '../lib/firebase';
import * as XLSX from 'xlsx';
import type { ItemMaster, ItemProjeto, Projeto } from '../types';

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

  const [formData, setFormData] = useState<Partial<ItemProjeto>>({
    memorialCalculo: '',
    quantidade: 1,
  });

  const carregarDados = async () => {
    if (!id) return;
    try {
      setLoading(true);
      
      // Projeto
      const projSnap = await getDoc(doc(db, 'projects', id));
      if (projSnap.exists()) setProjeto({ id: projSnap.id, ...projSnap.data() } as Projeto);

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
        <div className="bg-white rounded-xl shadow-premium p-6 border border-gray-100 mb-6 animate-fade-in relative">
          <h2 className="text-lg font-bold text-lie-ink mb-4">{editId ? 'Editar Item no Projeto' : 'Vincular Novo Item'}</h2>
          
          {showItemPicker ? (
            <div className="space-y-4">
              <label className="block text-sm font-bold text-gray-700">1. Busque o item no Banco de Dados Geral</label>
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
                {filteredMaster.map(m => (
                  <div 
                    key={m.id} 
                    onClick={() => selectMasterItem(m)}
                    className="p-3 hover:bg-gray-50 cursor-pointer flex items-center justify-between group transition-colors"
                  >
                    <div>
                      <div className="font-bold text-sm text-lie-ink">{m.nome}</div>
                      <div className="text-[10px] text-gray-500 uppercase tracking-tight font-bold">{m.categoria} • #{m.codigo} • {m.unidade}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-bold text-lie-green">
                        {m.valorUnitario.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                      </div>
                      <span className="text-[10px] text-gray-400 group-hover:text-lie-green">Clique para selecionar</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex justify-end">
                <button type="button" onClick={() => setIsFormOpen(false)} className="text-sm text-gray-500 hover:underline">Cancelar</button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {selectedMaster && (
                <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 flex items-center justify-between mb-2">
                  <div>
                    <span className="text-[10px] font-bold text-lie-green uppercase">Item Selecionado</span>
                    <h3 className="font-bold text-lie-ink">{selectedMaster.nome}</h3>
                    <p className="text-xs text-gray-500">{selectedMaster.unidade} • {selectedMaster.valorUnitario.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
                  </div>
                  {!editId && (
                    <button type="button" onClick={() => setShowItemPicker(true)} className="text-xs text-blue-600 hover:underline">Trocar Item</button>
                  )}
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
                    onChange={e => setFormData(p => ({...p, quantidade: parseFloat(e.target.value)}))} 
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
                  {saving ? 'Vinculando...' : editId ? 'Salvar Alterações' : 'Confirmar Vínculo'}
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
    </div>
  );
}
