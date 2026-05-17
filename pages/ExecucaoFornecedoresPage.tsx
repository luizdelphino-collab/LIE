import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link, useLocation } from 'react-router-dom';
import { collection, query, getDocs, doc, getDoc, writeBatch, orderBy } from 'firebase/firestore';
import { ArrowLeft, Save, Loader2, FileSpreadsheet, Users, CalendarDays, Check } from 'lucide-react';
import { db } from '../lib/firebase';
import * as XLSX from 'xlsx';
import type { ItemMaster, ItemProjeto, Projeto, Fornecedor } from '../types';

export default function ExecucaoFornecedoresPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const [projeto, setProjeto] = useState<Projeto | null>(null);
  const [itensProjeto, setItensProjeto] = useState<ItemProjeto[]>([]);
  const [itensMaster, setItensMaster] = useState<ItemMaster[]>([]);
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // selections[itemProjetoId] = array of fornecedorIds
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [pendingAdd, setPendingAdd] = useState<Record<string, string>>({});

  useEffect(() => {
    const carregarDados = async () => {
      if (!id) return;
      try {
        setLoading(true);
        const pSnap = await getDoc(doc(db, 'projects', id));
        if (pSnap.exists()) setProjeto({ id: pSnap.id, ...pSnap.data() } as Projeto);

        const [snapItems, snapMaster, snapForn] = await Promise.all([
          getDocs(query(collection(db, `projects/${id}/items`), orderBy('criadoEm', 'asc'))),
          getDocs(collection(db, 'items')),
          getDocs(collection(db, 'suppliers'))
        ]);

        const projItems = snapItems.docs.map(d => ({ id: d.id, ...d.data() } as ItemProjeto));
        setItensProjeto(projItems);
        setItensMaster(snapMaster.docs.map(d => ({ id: d.id, ...d.data() } as ItemMaster)));
        setFornecedores(snapForn.docs.map(d => ({ id: d.id, ...d.data() } as Fornecedor)));

        const initialSelections: Record<string, string[]> = {};
        projItems.forEach(it => {
          initialSelections[it.id] = it.fornecedoresIds || [];
        });
        setSelections(initialSelections);

      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    carregarDados();
  }, [id]);

  const toggleFornecedor = (itemId: string, fornId: string) => {
    setSelections(prev => {
      const current = prev[itemId] || [];
      if (current.includes(fornId)) {
        return { ...prev, [itemId]: current.filter(fid => fid !== fornId) };
      } else {
        return { ...prev, [itemId]: [...current, fornId] };
      }
    });
  };

  const handleAddFornecedor = (itemId: string) => {
    const fornId = pendingAdd[itemId];
    if (!fornId) return;
    setSelections(prev => {
      const current = prev[itemId] || [];
      if (!current.includes(fornId)) return { ...prev, [itemId]: [...current, fornId] };
      return prev;
    });
    setPendingAdd(prev => ({ ...prev, [itemId]: '' }));
  };

  const handleSave = async () => {
    if (!id) return;
    setSaving(true);
    try {
      const batch = writeBatch(db);
      for (const item of itensProjeto) {
        const itemRef = doc(db, `projects/${id}/items`, item.id);
        batch.update(itemRef, { fornecedoresIds: selections[item.id] || [] });
      }
      await batch.commit();
      
      // Update local state
      setItensProjeto(prev => prev.map(it => ({ ...it, fornecedoresIds: selections[it.id] || [] })));
      alert("Fornecedores vinculados com sucesso!");
    } catch (err) {
      console.error(err);
      alert("Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  };

  const exportExcel = () => {
    const headers = ['Cód', 'Item', 'Unidade', 'Quantidade Prevista', 'Valor Unitário (R$)', 'Valor Total Previsto (R$)', 'Fornecedores Indicados'];
    const rows = itensProjeto.map(it => {
      const master = itensMaster.find(m => m.id === it.itemId);
      const selIds = selections[it.id] || [];
      const fNames = selIds.map(fid => fornecedores.find(f => f.id === fid)?.razaoSocial || 'Desconhecido').join(', ');
      
      return [
        master ? String(master.codigo).padStart(3, '0') : '-',
        it.nome,
        it.unidade,
        it.quantidade,
        it.valorUnitario,
        it.valorTotal,
        fNames || 'Nenhum fornecedor'
      ];
    });

    const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    worksheet['!cols'] = [{ wch: 10 }, { wch: 40 }, { wch: 15 }, { wch: 15 }, { wch: 20 }, { wch: 20 }, { wch: 60 }];

    for (let r = 1; r <= rows.length; r++) {
      let cell = worksheet[XLSX.utils.encode_cell({ r, c: 4 })];
      if (cell && typeof cell.v === 'number') cell.z = '"R$ "#,##0.00';
      cell = worksheet[XLSX.utils.encode_cell({ r, c: 5 })];
      if (cell && typeof cell.v === 'number') cell.z = '"R$ "#,##0.00';
    }

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Fornecedores por Item');

    try {
      const wbout = XLSX.write(workbook, { bookType: 'xlsx', type: 'binary' });
      const s2ab = (s: string) => {
        const buf = new ArrayBuffer(s.length);
        const view = new Uint8Array(buf);
        for (let i = 0; i < s.length; i++) view[i] = s.charCodeAt(i) & 0xff;
        return buf;
      };
      const blob = new Blob([s2ab(wbout)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fornecedores_itens_${projeto?.titulo || 'lie'}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert("Erro ao exportar planilha.");
    }
  };

  if (loading) return <div className="p-6 text-lie-gray">Carregando painel de execução...</div>;

  return (
    <div className="p-6 max-w-7xl mx-auto pb-32">
      <header className="mb-8">
        <div className="flex items-center gap-4 mb-4">
          <button onClick={() => navigate('/execucao')} className="p-2 text-lie-gray hover:bg-gray-100 rounded-lg transition">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-black text-lie-ink">Execução: {projeto?.titulo}</h1>
            <p className="text-sm text-lie-gray">Etapa de planejamento de compras e relatórios de execução.</p>
          </div>
        </div>

        {/* Execução Navigation */}
        <div className="flex border-b border-gray-200">
          <Link 
            to={`/execucao/${id}/fornecedores`}
            className="px-6 py-3 border-b-2 font-bold text-sm flex items-center gap-2 border-lie-green text-lie-green"
          >
            <Users className="w-4 h-4" /> Indicação de Fornecedores
          </Link>
          <Link 
            to={`/execucao/${id}/mensal`}
            className="px-6 py-3 border-b-2 border-transparent text-gray-500 hover:text-gray-700 font-bold text-sm flex items-center gap-2 transition"
          >
            <CalendarDays className="w-4 h-4" /> Lançamentos Mensais
          </Link>
        </div>
      </header>

      <div className="bg-white rounded-xl shadow-premium border border-gray-100 p-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
          <div>
            <h2 className="text-lg font-bold text-lie-ink">Vincular Fornecedores aos Itens</h2>
            <p className="text-sm text-gray-500">Selecione quais fornecedores poderão emitir NFs para cada item.</p>
          </div>
          <div className="flex gap-2">
            <button 
              onClick={exportExcel}
              className="group flex items-center bg-white border border-gray-300 text-green-700 rounded-lg p-2 transition-all duration-300 overflow-hidden hover:bg-green-50 shadow-sm"
            >
              <FileSpreadsheet className="w-5 h-5 shrink-0" />
              <span className="max-w-0 opacity-0 group-hover:max-w-xs group-hover:opacity-100 group-hover:ml-2 whitespace-nowrap transition-all duration-300 ease-in-out font-medium">
                Planilha de Fornecedores
              </span>
            </button>
            <button 
              onClick={handleSave}
              disabled={saving}
              className="group flex items-center bg-lie-green text-white rounded-lg p-2 transition-all duration-300 overflow-hidden hover:bg-lie-greenDark shadow-sm disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-5 h-5 shrink-0 animate-spin" /> : <Save className="w-5 h-5 shrink-0" />}
              <span className="max-w-0 opacity-0 group-hover:max-w-xs group-hover:opacity-100 group-hover:ml-2 whitespace-nowrap transition-all duration-300 ease-in-out font-medium">
                {saving ? 'Salvando...' : 'Salvar Vínculos'}
              </span>
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-gray-50 text-xs font-bold text-lie-gray uppercase border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 w-16">Cód</th>
                <th className="px-4 py-3 w-64">Item</th>
                <th className="px-4 py-3 text-center">Unidade</th>
                <th className="px-4 py-3 text-center">Qtd Prevista</th>
                <th className="px-4 py-3 text-right">$ Unitário</th>
                <th className="px-4 py-3 text-right">$ Total Previsto</th>
                <th className="px-4 py-3">Fornecedores Vinculados</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {itensProjeto.map(it => {
                const master = itensMaster.find(m => m.id === it.itemId);
                const itemSels = selections[it.id] || [];

                return (
                  <tr key={it.id} className="hover:bg-gray-50">
                    <td className="px-4 py-4 text-xs font-mono text-gray-500">
                      {master ? `#${String(master.codigo).padStart(3, '0')}` : '-'}
                    </td>
                    <td className="px-4 py-4">
                      <div className="font-bold text-lie-ink">{it.nome}</div>
                    </td>
                    <td className="px-4 py-4 text-sm text-center">{it.unidade}</td>
                    <td className="px-4 py-4 text-sm text-center font-bold">{it.quantidade}</td>
                    <td className="px-4 py-4 text-sm text-right text-gray-500">
                      {it.valorUnitario.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </td>
                    <td className="px-4 py-4 text-sm font-bold text-right text-lie-ink">
                      {it.valorTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </td>
                    <td className="px-4 py-4 min-w-[320px]">
                      <div className="flex flex-wrap gap-2 mb-3">
                        {itemSels.map(fid => {
                          const f = fornecedores.find(x => x.id === fid);
                          if (!f) return null;
                          return (
                            <span key={fid} className="flex items-center gap-1.5 px-3 py-1 bg-blue-50 text-blue-700 text-xs font-bold rounded-full border border-blue-200">
                              {f.razaoSocial}
                              <button onClick={() => toggleFornecedor(it.id, fid)} className="text-blue-400 hover:text-red-500 ml-1 transition">
                                &times;
                              </button>
                            </span>
                          );
                        })}
                      </div>
                      <div className="flex gap-2">
                        <select 
                          value={pendingAdd[it.id] || ''} 
                          onChange={e => setPendingAdd(prev => ({...prev, [it.id]: e.target.value}))}
                          className="flex-1 text-xs border-gray-300 rounded-lg py-2 shadow-sm"
                        >
                          <option value="">Selecione um fornecedor para vincular...</option>
                          {fornecedores.filter(f => !itemSels.includes(f.id)).map(f => (
                            <option key={f.id} value={f.id}>{f.razaoSocial}</option>
                          ))}
                        </select>
                        <button 
                          onClick={() => handleAddFornecedor(it.id)}
                          disabled={!pendingAdd[it.id]}
                          title="Adicionar Fornecedor"
                          className="bg-blue-600 text-white p-2 rounded-lg disabled:opacity-50 transition hover:bg-blue-700 flex items-center justify-center shrink-0"
                        >
                          <Plus className="w-5 h-5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {itensProjeto.length === 0 && (
            <div className="p-8 text-center text-lie-gray">Nenhum item cadastrado no projeto.</div>
          )}
        </div>
      </div>
    </div>
  );
}
