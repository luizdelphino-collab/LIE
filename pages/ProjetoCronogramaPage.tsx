import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { collection, query, getDocs, doc, getDoc, writeBatch, serverTimestamp, orderBy } from 'firebase/firestore';
import { ArrowLeft, Save, Loader2, FileSpreadsheet, Calendar as CalendarIcon, CheckCircle2 } from 'lucide-react';
import { db } from '../lib/firebase';
import * as XLSX from 'xlsx';
import type { ItemMaster, ItemProjeto, Projeto, CronogramaItem } from '../types';

export default function ProjetoCronogramaPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [projeto, setProjeto] = useState<Projeto | null>(null);
  const [itensProjeto, setItensProjeto] = useState<ItemProjeto[]>([]);
  const [itensMaster, setItensMaster] = useState<ItemMaster[]>([]);
  const [cronogramaItems, setCronogramaItems] = useState<CronogramaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // allocations[itemId][mes] = quantidade
  const [allocations, setAllocations] = useState<Record<string, Record<number, number>>>({});
  const [monthLocked, setMonthLocked] = useState<Record<number, boolean>>({});
  
  const [selectedTab, setSelectedTab] = useState<number | 'resumo'>(1);
  const duracaoMeses = projeto?.duracaoMeses || 12;

  const carregarDados = async () => {
    if (!id) return;
    try {
      setLoading(true);
      
      const projSnap = await getDoc(doc(db, 'projects', id));
      if (projSnap.exists()) setProjeto({ id: projSnap.id, ...projSnap.data() } as Projeto);

      const snapProj = await getDocs(query(collection(db, `projects/${id}/items`), orderBy('criadoEm', 'asc')));
      const projItems = snapProj.docs.map(d => ({ id: d.id, ...d.data() } as ItemProjeto));
      setItensProjeto(projItems);

      const snapMaster = await getDocs(query(collection(db, 'items')));
      setItensMaster(snapMaster.docs.map(d => ({ id: d.id, ...d.data() } as ItemMaster)));

      const snapCron = await getDocs(collection(db, `projects/${id}/cronograma`));
      const cronItems = snapCron.docs.map(d => ({ id: d.id, ...d.data() } as CronogramaItem));
      setCronogramaItems(cronItems);

      // Build allocations state
      const initialAllocations: Record<string, Record<number, number>> = {};
      const initialLocked: Record<number, boolean> = {};
      projItems.forEach(it => initialAllocations[it.id] = {});
      
      cronItems.forEach(ci => {
        if (!initialAllocations[ci.itemProjetoId]) {
          initialAllocations[ci.itemProjetoId] = {};
        }
        initialAllocations[ci.itemProjetoId][ci.mes] = ci.quantidade;
        if (ci.quantidade > 0) initialLocked[ci.mes] = true;
      });

      setAllocations(initialAllocations);
      setMonthLocked(initialLocked);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregarDados();
  }, [id]);

  const handleQtyChange = (itemProjetoId: string, mes: number, rawValue: string, maxQty: number) => {
    let val = parseFloat(rawValue);
    if (isNaN(val) || val < 0) val = 0;

    // Validate that sum of all other months + this val doesn't exceed maxQty
    const currentAlloc = allocations[itemProjetoId] || {};
    let sumOtherMonths = 0;
    Object.keys(currentAlloc).forEach(mStr => {
      const m = parseInt(mStr);
      if (m !== mes) sumOtherMonths += currentAlloc[m] || 0;
    });

    if (sumOtherMonths + val > maxQty) {
      val = maxQty - sumOtherMonths; // Cap it
    }

    setAllocations(prev => ({
      ...prev,
      [itemProjetoId]: {
        ...prev[itemProjetoId],
        [mes]: val
      }
    }));
  };

  const handleSave = async () => {
    if (!id) return;
    setSaving(true);
    try {
      const batch = writeBatch(db);
      
      // Delete all existing items first to keep it clean (or we can just update).
      // Since it's a subcollection, deleting existing and rewriting is easier to handle zeros.
      for (const ci of cronogramaItems) {
        batch.delete(doc(db, `projects/${id}/cronograma`, ci.id));
      }

      const newCronItems: CronogramaItem[] = [];

      for (const item of itensProjeto) {
        const itemAllocs = allocations[item.id] || {};
        for (const [mesStr, qty] of Object.entries(itemAllocs)) {
          if (qty > 0) {
            const mes = parseInt(mesStr);
            const docRef = doc(collection(db, `projects/${id}/cronograma`));
            const ci: Partial<CronogramaItem> = {
              id: docRef.id,
              projectId: id,
              itemProjetoId: item.id,
              mes,
              quantidade: qty,
              valorTotal: qty * item.valorUnitario,
              criadoEm: serverTimestamp() as any
            };
            batch.set(docRef, ci);
            newCronItems.push(ci as CronogramaItem);
          }
        }
      }

      await batch.commit();
      setCronogramaItems(newCronItems);
      
      const newLocked = { ...monthLocked };
      for (let m = 1; m <= duracaoMeses; m++) {
        let hasAlloc = false;
        for (const item of itensProjeto) {
          if ((allocations[item.id] || {})[m] > 0) hasAlloc = true;
        }
        if (hasAlloc) newLocked[m] = true;
      }
      setMonthLocked(newLocked);

      alert("Cronograma salvo com sucesso!");
    } catch (e) {
      console.error(e);
      alert("Erro ao salvar cronograma");
    } finally {
      setSaving(false);
    }
  };

  const exportToExcel = () => {
    if (itensProjeto.length === 0) return;

    const headers = [
      'Nº',
      'Item',
      'Unidade',
      'Qtd Total',
      'Valor Unitário (R$)',
      'Valor Total (R$)'
    ];

    // Add columns for each month
    for (let m = 1; m <= duracaoMeses; m++) {
      headers.push(`Mês ${m} (Qtd)`);
      headers.push(`Mês ${m} (R$)`);
    }

    const rows = itensProjeto.map(it => {
      const master = itensMaster.find(m => m.id === it.itemId);
      const rowData: any[] = [
        master ? String(master.codigo).padStart(3, '0') : '-',
        it.nome,
        it.unidade,
        it.quantidade,
        it.valorUnitario,
        it.valorTotal
      ];

      const itemAllocs = allocations[it.id] || {};
      for (let m = 1; m <= duracaoMeses; m++) {
        const qty = itemAllocs[m] || 0;
        rowData.push(qty);
        rowData.push(qty * it.valorUnitario);
      }
      return rowData;
    });

    const totalRow = [
      '',
      'TOTAL GERAL',
      '',
      '',
      '',
      itensProjeto.reduce((acc, it) => acc + it.valorTotal, 0)
    ];

    // Total for each month
    for (let m = 1; m <= duracaoMeses; m++) {
      let sumQty = 0;
      let sumVal = 0;
      itensProjeto.forEach(it => {
        const qty = (allocations[it.id] || {})[m] || 0;
        sumQty += qty;
        sumVal += qty * it.valorUnitario;
      });
      totalRow.push(sumQty);
      totalRow.push(sumVal);
    }

    const fileData = [headers, ...rows, totalRow];
    const worksheet = XLSX.utils.aoa_to_sheet(fileData);

    // Format Number/Currency cells
    // columns:
    // 0: Nº, 1: Item, 2: Unidade
    // 3: Qtd Total (n)
    // 4: Valor Unitário (currency)
    // 5: Valor Total (currency)
    // Then pairs of (Qtd, Currency) starting at index 6

    for (let r = 1; r < fileData.length; r++) {
      // Format Qtd Total (col 3)
      let cell = worksheet[XLSX.utils.encode_cell({ r, c: 3 })];
      if (cell && typeof cell.v === 'number') cell.z = '#,##0.00';

      // Format V. Unitário (col 4)
      cell = worksheet[XLSX.utils.encode_cell({ r, c: 4 })];
      if (cell && typeof cell.v === 'number') cell.z = '"R$ "#,##0.00';

      // Format V. Total (col 5)
      cell = worksheet[XLSX.utils.encode_cell({ r, c: 5 })];
      if (cell && typeof cell.v === 'number') cell.z = '"R$ "#,##0.00';

      // Month columns
      let cIdx = 6;
      for (let m = 1; m <= duracaoMeses; m++) {
        // Qtd Month
        cell = worksheet[XLSX.utils.encode_cell({ r, c: cIdx })];
        if (cell && typeof cell.v === 'number') cell.z = '#,##0.00';
        cIdx++;
        // Val Month
        cell = worksheet[XLSX.utils.encode_cell({ r, c: cIdx })];
        if (cell && typeof cell.v === 'number') cell.z = '"R$ "#,##0.00';
        cIdx++;
      }
    }

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Cronograma Físico-Financeiro');

    // Aba 2: Resumo Mensal
    const resumoHeaders = ['Mês', 'Total Previsto (R$)'];
    const resumoRows = [];
    let totalGeralResumo = 0;
    
    for (let m = 1; m <= duracaoMeses; m++) {
      let sumVal = 0;
      itensProjeto.forEach(it => {
        const qty = (allocations[it.id] || {})[m] || 0;
        sumVal += qty * it.valorUnitario;
      });
      resumoRows.push([`Mês ${m}`, sumVal]);
      totalGeralResumo += sumVal;
    }
    
    const resumoFileData = [resumoHeaders, ...resumoRows, ['TOTAL DO PROJETO', totalGeralResumo]];
    const worksheetResumo = XLSX.utils.aoa_to_sheet(resumoFileData);
    
    for (let r = 1; r < resumoFileData.length; r++) {
      const cell = worksheetResumo[XLSX.utils.encode_cell({ r, c: 1 })];
      if (cell && typeof cell.v === 'number') cell.z = '"R$ "#,##0.00';
    }
    worksheetResumo['!cols'] = [{ wch: 20 }, { wch: 25 }];
    XLSX.utils.book_append_sheet(workbook, worksheetResumo, 'Resumo Mensal');

    const maxWidths = fileData.reduce((acc, row) => {
      row.forEach((val, i) => {
        let strVal = String(val || '');
        if (typeof val === 'number' && i > 3) {
          // just an approximation for formatting width
          strVal = 'R$ ' + val.toFixed(2);
        }
        acc[i] = Math.max(acc[i] || 0, strVal.length);
      });
      return acc;
    }, [] as number[]);
    worksheet['!cols'] = maxWidths.map(w => ({ wch: w + 2 }));

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
      a.download = `cronograma_${projeto?.titulo || 'lie'}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert("Erro ao baixar a planilha.");
    }
  };

  const calculateTotalDistributed = (itemId: string) => {
    const itemAllocs = allocations[itemId] || {};
    return Object.values(itemAllocs).reduce((acc, val) => acc + (val || 0), 0);
  };

  const monthTotalVal = typeof selectedTab === 'number' ? itensProjeto.reduce((acc, it) => {
    const qty = (allocations[it.id] || {})[selectedTab] || 0;
    return acc + (qty * it.valorUnitario);
  }, 0) : 0;

  if (loading) return <div className="p-6 text-lie-gray">Carregando cronograma...</div>;

  return (
    <div className="p-6 max-w-7xl mx-auto pb-32">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate(`/projetos/${id}`)} className="p-2 text-lie-gray hover:bg-gray-100 rounded-lg transition">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-lie-ink flex items-center gap-2">
              <CalendarIcon className="w-6 h-6 text-lie-green" /> Cronograma de Execução
            </h1>
            <p className="text-sm text-lie-gray">{projeto?.titulo}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={exportToExcel} 
            disabled={itensProjeto.length === 0}
            className="inline-flex items-center gap-2 bg-white border border-gray-300 text-green-700 hover:bg-green-50 font-medium px-4 py-2 rounded-lg shadow-sm transition disabled:opacity-50"
          >
            <FileSpreadsheet className="w-4 h-4" /> Exportar Planilha Completa
          </button>
          <button 
            onClick={handleSave} 
            disabled={saving}
            className="inline-flex items-center gap-2 bg-lie-green hover:bg-lie-greenDark text-white font-bold px-6 py-2 rounded-lg shadow-sm transition"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? 'Salvando...' : 'Salvar Cronograma'}
          </button>
        </div>
      </header>

      {/* Month Selector */}
      <div className="flex items-center gap-2 overflow-x-auto pb-4 mb-2 scrollbar-thin">
        {Array.from({ length: duracaoMeses }).map((_, i) => {
          const m = i + 1;
          const isSelected = selectedTab === m;
          const isLocked = monthLocked[m];
          return (
            <button
              key={m}
              onClick={() => setSelectedTab(m)}
              className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-bold transition-colors flex items-center gap-2 ${
                isSelected 
                  ? 'bg-lie-ink text-white shadow-md' 
                  : 'bg-white text-gray-500 border border-gray-200 hover:bg-gray-50'
              }`}
            >
              Mês {m} {isLocked && <div className={`w-2 h-2 rounded-full ${isSelected ? 'bg-white/50' : 'bg-gray-300'}`}></div>}
            </button>
          );
        })}
        <button
          onClick={() => setSelectedTab('resumo')}
          className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-bold transition-colors ${
            selectedTab === 'resumo' 
              ? 'bg-amber-500 text-white shadow-md' 
              : 'bg-white text-amber-600 border border-amber-200 hover:bg-amber-50'
          }`}
        >
          Resumo Financeiro
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-premium overflow-hidden border border-gray-100">
        {selectedTab === 'resumo' ? (
          <div>
            <div className="p-4 bg-amber-50 border-b border-amber-100 flex justify-between items-center">
              <h2 className="font-bold text-amber-900 text-lg">Resumo Financeiro do Projeto</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-white text-xs font-bold text-lie-gray uppercase border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-4">Mês de Execução</th>
                    <th className="px-6 py-4 text-right">Total Financeiro Previsto</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {Array.from({ length: duracaoMeses }).map((_, i) => {
                    const m = i + 1;
                    const val = itensProjeto.reduce((acc, it) => acc + (((allocations[it.id] || {})[m] || 0) * it.valorUnitario), 0);
                    return (
                      <tr key={m} className="hover:bg-gray-50">
                        <td className="px-6 py-4 font-bold text-lie-ink">Mês {m}</td>
                        <td className="px-6 py-4 text-right font-medium text-gray-700">
                          {val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-gray-100 border-t-2 border-gray-200">
                  <tr>
                    <td className="px-6 py-5 font-black text-lie-ink text-lg uppercase">Total Geral do Projeto</td>
                    <td className="px-6 py-5 text-right font-black text-lie-green text-2xl">
                      {itensProjeto.reduce((acc, it) => acc + it.valorTotal, 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        ) : (
          <div>
            <div className="p-4 bg-gray-50 border-b border-gray-200 flex justify-between items-center">
              <div className="flex items-center gap-4">
                <h2 className="font-bold text-lie-ink text-lg">Distribuição — Mês {selectedTab}</h2>
                {monthLocked[selectedTab] && (
                  <button 
                    onClick={() => setMonthLocked(prev => ({...prev, [selectedTab]: false}))}
                    className="text-xs bg-white border border-gray-300 px-3 py-1.5 rounded-full font-bold text-blue-600 hover:bg-blue-50 transition"
                  >
                    Editar Mês {selectedTab}
                  </button>
                )}
                {!monthLocked[selectedTab] && Object.values(allocations).some(a => a[selectedTab] > 0) && (
                  <span className="text-xs bg-amber-100 text-amber-800 px-3 py-1.5 rounded-full font-bold">
                    Modo de Edição Aberto
                  </span>
                )}
              </div>
              <div className="text-sm">
                <span className="text-gray-500">Subtotal do Mês: </span>
                <span className="font-black text-lie-green text-xl">{monthTotalVal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-white text-xs font-bold text-lie-gray uppercase border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 w-16">Cód</th>
                    <th className="px-4 py-3">Item do Projeto</th>
                    <th className="px-4 py-3 w-20 text-center">Unidade</th>
                    <th className="px-4 py-3 w-32 text-center">Progresso (Qtd)</th>
                    <th className={`px-4 py-3 w-36 ${monthLocked[selectedTab] ? 'bg-gray-50 text-gray-500' : 'bg-emerald-50 text-emerald-800'} border-l border-emerald-100`}>Qtd no Mês {selectedTab}</th>
                    <th className="px-4 py-3 w-32 text-right">$ Unitário</th>
                    <th className="px-4 py-3 w-36 text-right font-bold text-lie-ink bg-gray-50">$ Total Mês {selectedTab}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {itensProjeto.map(it => {
                    const master = itensMaster.find(m => m.id === it.itemId);
                    const distributed = calculateTotalDistributed(it.id);
                    const currentQty = (allocations[it.id] || {})[selectedTab] || 0;
                    const isComplete = distributed === it.quantidade;

                    return (
                      <tr key={it.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 text-xs font-mono text-gray-500">
                          {master ? `#${String(master.codigo).padStart(3, '0')}` : '-'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-bold text-lie-ink">{it.nome}</div>
                          {it.descricao && <div className="text-[10px] text-gray-400 truncate max-w-[200px]">{it.descricao}</div>}
                        </td>
                        <td className="px-4 py-3 text-sm text-center">{it.unidade}</td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <span className={`text-xs font-bold ${distributed > 0 ? (isComplete ? 'text-green-600' : 'text-blue-600') : 'text-gray-400'}`}>
                              {distributed} / {it.quantidade}
                            </span>
                            {isComplete && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                          </div>
                          <div className="w-full bg-gray-200 h-1.5 mt-1 rounded-full overflow-hidden">
                            <div 
                              className={`h-full ${isComplete ? 'bg-green-500' : 'bg-blue-500'}`} 
                              style={{ width: `${Math.min(100, (distributed / it.quantidade) * 100)}%` }}
                            ></div>
                          </div>
                        </td>
                        <td className={`px-4 py-3 ${monthLocked[selectedTab] ? 'bg-gray-50' : 'bg-emerald-50/50'} border-l border-emerald-100`}>
                          <input 
                            type="number"
                            min="0"
                            step="0.01"
                            value={currentQty || ''}
                            onChange={(e) => handleQtyChange(it.id, selectedTab, e.target.value, it.quantidade)}
                            disabled={monthLocked[selectedTab]}
                            className={`w-full rounded text-center font-bold shadow-inner ${monthLocked[selectedTab] ? 'bg-gray-100 border-gray-200 text-gray-500' : 'border-emerald-200 focus:ring-emerald-500 focus:border-emerald-500 text-emerald-800'}`}
                            placeholder="0"
                          />
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-gray-500">
                          {it.valorUnitario.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                        </td>
                        <td className="px-4 py-3 text-sm font-bold text-right text-lie-ink bg-gray-50">
                          {(currentQty * it.valorUnitario).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {itensProjeto.length > 0 && (
                  <tfoot className="bg-gray-100 border-t-2 border-gray-200">
                    <tr>
                      <td colSpan={6} className="px-4 py-4 text-right font-bold text-lie-ink uppercase text-xs">Total Financeiro do Mês {selectedTab}:</td>
                      <td className="px-4 py-4 text-right font-black text-lie-green text-lg">
                        {monthTotalVal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
              {itensProjeto.length === 0 && (
                <div className="p-12 text-center text-lie-gray italic">Nenhum item cadastrado no projeto. Adicione itens primeiro.</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
