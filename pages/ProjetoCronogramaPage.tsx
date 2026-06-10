import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { collection, query, getDocs, doc, getDoc, writeBatch, serverTimestamp, orderBy } from 'firebase/firestore';
import { ArrowLeft, Save, Loader2, FileSpreadsheet, Calendar as CalendarIcon, CheckCircle2, Unlock, FileText, Folder } from 'lucide-react';
import { db } from '../lib/firebase';
import * as XLSX from 'xlsx';
import type { ItemMaster, ItemProjeto, Projeto, CronogramaItem, ModuloProjeto } from '../types';

const round2 = (num: number) => Math.round((num + Number.EPSILON) * 100) / 100;

export default function ProjetoCronogramaPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [projeto, setProjeto] = useState<Projeto | null>(null);
  const [modulos, setModulos] = useState<ModuloProjeto[]>([]);
  const [itensProjeto, setItensProjeto] = useState<ItemProjeto[]>([]);
  const [itensMaster, setItensMaster] = useState<ItemMaster[]>([]);
  const [cronogramaItems, setCronogramaItems] = useState<CronogramaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);

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

      const snapModulos = await getDocs(query(collection(db, `projects/${id}/modulos`), orderBy('criadoEm', 'asc')));
      setModulos(snapModulos.docs.map(d => ({ id: d.id, ...d.data() } as ModuloProjeto)));

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
    val = round2(val);

    // Validate that sum of all other months + this val doesn't exceed maxQty
    const currentAlloc = allocations[itemProjetoId] || {};
    let sumOtherMonths = 0;
    Object.keys(currentAlloc).forEach(mStr => {
      const m = parseInt(mStr);
      if (m !== mes) sumOtherMonths += currentAlloc[m] || 0;
    });
    sumOtherMonths = round2(sumOtherMonths);

    if (round2(sumOtherMonths + val) > maxQty) {
      val = round2(maxQty - sumOtherMonths); // Cap it
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

      alert("Cronograma salvo com sucesso!");
    } catch (e) {
      console.error(e);
      alert("Erro ao salvar cronograma");
    } finally {
      setSaving(false);
    }
  };

  const unlockAllMonths = () => {
    setMonthLocked({});
  };

  const exportToExcel = () => {
    if (itensProjeto.length === 0) return;

    const headers = [
      'Nº',
      'Módulo',
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

    const generateRowsForItems = (items: ItemProjeto[]) => {
      const rows = items.map(it => {
        const master = itensMaster.find(m => m.id === it.itemId);
        const mod = modulos.find(m => m.id === it.moduloId);
        const rowData: any[] = [
          master ? String(master.codigo).padStart(3, '0') : '-',
          mod ? mod.nome : 'Sem Módulo',
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
        '',
        'TOTAL',
        '',
        '',
        '',
        items.reduce((acc, it) => acc + it.valorTotal, 0)
      ];

      for (let m = 1; m <= duracaoMeses; m++) {
        let sumQty = 0;
        let sumVal = 0;
        items.forEach(it => {
          const qty = (allocations[it.id] || {})[m] || 0;
          sumQty += qty;
          sumVal += qty * it.valorUnitario;
        });
        totalRow.push(sumQty);
        totalRow.push(sumVal);
      }

      return [...rows, totalRow];
    };

    const formatSheetCols = (ws: XLSX.WorkSheet, fileDataLength: number) => {
      for (let r = 1; r < fileDataLength; r++) {
        // Qtd Total (col 4 / idx 4)
        let cell = ws[XLSX.utils.encode_cell({ r, c: 4 })];
        if (cell && typeof cell.v === 'number') cell.z = '#,##0.00';

        // V. Unitário (col 5 / idx 5)
        cell = ws[XLSX.utils.encode_cell({ r, c: 5 })];
        if (cell && typeof cell.v === 'number') cell.z = '"R$ "#,##0.00';

        // V. Total (col 6 / idx 6)
        cell = ws[XLSX.utils.encode_cell({ r, c: 6 })];
        if (cell && typeof cell.v === 'number') cell.z = '"R$ "#,##0.00';

        let cIdx = 7;
        for (let m = 1; m <= duracaoMeses; m++) {
          cell = ws[XLSX.utils.encode_cell({ r, c: cIdx })];
          if (cell && typeof cell.v === 'number') cell.z = '#,##0.00';
          cIdx++;
          cell = ws[XLSX.utils.encode_cell({ r, c: cIdx })];
          if (cell && typeof cell.v === 'number') cell.z = '"R$ "#,##0.00';
          cIdx++;
        }
      }
    };

    const workbook = XLSX.utils.book_new();

    // Aba Geral
    const geralRows = generateRowsForItems(itensProjeto);
    const geralData = [headers, ...geralRows];
    const wsGeral = XLSX.utils.aoa_to_sheet(geralData);
    formatSheetCols(wsGeral, geralData.length);
    const maxWidthsGeral = geralData.reduce((acc, row) => {
      row.forEach((val, i) => {
        let strVal = String(val || '');
        if (typeof val === 'number' && i > 4) strVal = 'R$ ' + val.toFixed(2);
        acc[i] = Math.max(acc[i] || 0, strVal.length);
      });
      return acc;
    }, [] as number[]);
    wsGeral['!cols'] = maxWidthsGeral.map(w => ({ wch: w + 2 }));
    XLSX.utils.book_append_sheet(workbook, wsGeral, 'Geral');

    // Abas por Módulo
    modulos.forEach(mod => {
      const modItems = itensProjeto.filter(it => it.moduloId === mod.id);
      if (modItems.length > 0) {
        const modRows = generateRowsForItems(modItems);
        const modData = [headers, ...modRows];
        const wsMod = XLSX.utils.aoa_to_sheet(modData);
        formatSheetCols(wsMod, modData.length);
        wsMod['!cols'] = maxWidthsGeral.map(w => ({ wch: w + 2 }));
        XLSX.utils.book_append_sheet(workbook, wsMod, mod.nome.substring(0, 31)); // excel sheet limit
      }
    });

    const semModuloItems = itensProjeto.filter(it => !it.moduloId);
    if (semModuloItems.length > 0) {
      const smRows = generateRowsForItems(semModuloItems);
      const smData = [headers, ...smRows];
      const wsSm = XLSX.utils.aoa_to_sheet(smData);
      formatSheetCols(wsSm, smData.length);
      wsSm['!cols'] = maxWidthsGeral.map(w => ({ wch: w + 2 }));
      XLSX.utils.book_append_sheet(workbook, wsSm, 'Sem Módulo');
    }

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

    // Aba 3: Resumo por Módulo
    const resumoModuloHeaders = ['Módulo', ...Array.from({ length: duracaoMeses }).map((_, i) => `Mês ${i+1}`), 'Total (R$)'];
    const resumoModuloRows = [];
    
    modulos.forEach(mod => {
      const row: (string | number)[] = [mod.nome];
      let totalMod = 0;
      for (let m = 1; m <= duracaoMeses; m++) {
        let sumMes = 0;
        itensProjeto.filter(it => it.moduloId === mod.id).forEach(it => {
          const qty = (allocations[it.id] || {})[m] || 0;
          sumMes += qty * it.valorUnitario;
        });
        row.push(sumMes);
        totalMod += sumMes;
      }
      row.push(totalMod);
      resumoModuloRows.push(row);
    });

    const rowSemModulo: (string | number)[] = ['Sem Módulo'];
    let totalSem = 0;
    for (let m = 1; m <= duracaoMeses; m++) {
      let sumMes = 0;
      itensProjeto.filter(it => !it.moduloId).forEach(it => {
        const qty = (allocations[it.id] || {})[m] || 0;
        sumMes += qty * it.valorUnitario;
      });
      rowSemModulo.push(sumMes);
      totalSem += sumMes;
    }
    if (totalSem > 0) resumoModuloRows.push(rowSemModulo);

    const resumoModFileData = [resumoModuloHeaders, ...resumoModuloRows];
    const wsResumoMod = XLSX.utils.aoa_to_sheet(resumoModFileData);
    for (let r = 1; r < resumoModFileData.length; r++) {
      for (let c = 1; c <= duracaoMeses + 1; c++) {
        const cell = wsResumoMod[XLSX.utils.encode_cell({ r, c })];
        if (cell && typeof cell.v === 'number') cell.z = '"R$ "#,##0.00';
      }
    }
    XLSX.utils.book_append_sheet(workbook, wsResumoMod, 'Resumo por Módulo');

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

  const handleExportPdf = async () => {
    if (!id || itensProjeto.length === 0) return;
    setGeneratingPdf(true);
    try {
      const { consolidarCronograma } = await import('../lib/consolidarCronograma');
      await consolidarCronograma(id, allocations);
    } catch (err) {
      console.error(err);
      alert("Erro ao gerar o PDF do Cronograma: " + (err instanceof Error ? err.message : 'Erro desconhecido'));
    } finally {
      setGeneratingPdf(false);
    }
  };

  const calculateTotalDistributed = (itemId: string) => {
    const itemAllocs = allocations[itemId] || {};
    const sum = Object.values(itemAllocs).reduce((acc, val) => acc + (val || 0), 0);
    return round2(sum);
  };

  const calculateTotalGeralDistribuido = () => {
    let total = 0;
    for (let m = 1; m <= duracaoMeses; m++) {
      itensProjeto.forEach(it => {
        const qty = (allocations[it.id] || {})[m] || 0;
        total += qty * it.valorUnitario;
      });
    }
    return total;
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
          {Object.keys(monthLocked).length > 0 && (
            <button 
              onClick={unlockAllMonths} 
              className="group flex items-center bg-white border border-gray-300 text-blue-600 rounded-lg p-2 transition-all duration-300 overflow-hidden hover:bg-blue-50 shadow-sm"
              title="Destravar Edição de Todos os Meses"
            >
              <Unlock className="w-5 h-5 shrink-0" />
              <span className="max-w-0 opacity-0 group-hover:max-w-xs group-hover:opacity-100 group-hover:ml-2 whitespace-nowrap transition-all duration-300 ease-in-out font-medium">
                Liberar Edição Geral
              </span>
            </button>
          )}
          <button 
            onClick={exportToExcel} 
            disabled={itensProjeto.length === 0}
            className="group flex items-center bg-white border border-gray-300 text-green-700 rounded-lg p-2 transition-all duration-300 overflow-hidden hover:bg-green-50 shadow-sm disabled:opacity-50"
          >
            <FileSpreadsheet className="w-5 h-5 shrink-0" />
            <span className="max-w-0 opacity-0 group-hover:max-w-xs group-hover:opacity-100 group-hover:ml-2 whitespace-nowrap transition-all duration-300 ease-in-out font-medium">
              Exportar Planilha Completa
            </span>
          </button>
          <button 
            onClick={handleExportPdf} 
            disabled={generatingPdf || itensProjeto.length === 0}
            className="group flex items-center bg-white border border-gray-300 text-red-700 rounded-lg p-2 transition-all duration-300 overflow-hidden hover:bg-red-50 shadow-sm disabled:opacity-50"
            title="Gerar PDF do Cronograma"
          >
            {generatingPdf ? (
              <Loader2 className="w-5 h-5 shrink-0 animate-spin text-red-700" />
            ) : (
              <FileText className="w-5 h-5 shrink-0 text-red-700" />
            )}
            <span className="max-w-0 opacity-0 group-hover:max-w-xs group-hover:opacity-100 group-hover:ml-2 whitespace-nowrap transition-all duration-300 ease-in-out font-medium">
              {generatingPdf ? 'Gerando PDF...' : 'Gerar PDF do Cronograma'}
            </span>
          </button>
          <button 
            onClick={handleSave} 
            disabled={saving}
            className="group flex items-center bg-lie-green text-white rounded-lg p-2 transition-all duration-300 overflow-hidden hover:bg-lie-greenDark shadow-sm"
          >
            {saving ? <Loader2 className="w-5 h-5 shrink-0 animate-spin" /> : <Save className="w-5 h-5 shrink-0" />}
            <span className="max-w-0 opacity-0 group-hover:max-w-xs group-hover:opacity-100 group-hover:ml-2 whitespace-nowrap transition-all duration-300 ease-in-out font-medium">
              {saving ? 'Salvando...' : 'Salvar Cronograma'}
            </span>
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
            <div className="overflow-x-auto mb-8">
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
                    <td className="px-6 py-5 font-black text-lie-ink text-lg uppercase">Total Geral do Projeto (Valores Distribuídos)</td>
                    <td className="px-6 py-5 text-right font-black text-lie-green text-2xl">
                      {calculateTotalGeralDistribuido().toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="p-4 bg-emerald-50 border-b border-emerald-100 flex justify-between items-center">
              <h2 className="font-bold text-emerald-900 text-lg">Resumo Financeiro por Módulo</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left whitespace-nowrap">
                <thead className="bg-white text-xs font-bold text-lie-gray uppercase border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-4 sticky left-0 bg-white z-10">Módulo</th>
                    {Array.from({ length: duracaoMeses }).map((_, i) => (
                      <th key={i} className="px-4 py-4 text-right">Mês {i + 1}</th>
                    ))}
                    <th className="px-4 py-4 text-right text-lie-ink">Total Geral</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {modulos.map(mod => {
                    let totalMod = 0;
                    return (
                      <tr key={mod.id} className="hover:bg-gray-50">
                        <td className="px-4 py-4 font-bold text-lie-ink sticky left-0 bg-white group-hover:bg-gray-50 transition-colors z-10 border-r">{mod.nome}</td>
                        {Array.from({ length: duracaoMeses }).map((_, i) => {
                          const m = i + 1;
                          let sumMes = 0;
                          itensProjeto.filter(it => it.moduloId === mod.id).forEach(it => {
                            const qty = (allocations[it.id] || {})[m] || 0;
                            sumMes += qty * it.valorUnitario;
                          });
                          totalMod += sumMes;
                          return (
                            <td key={m} className="px-4 py-4 text-right font-medium text-gray-700">
                              {sumMes > 0 ? sumMes.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '-'}
                            </td>
                          );
                        })}
                        <td className="px-4 py-4 text-right font-black text-lie-ink bg-gray-50">
                          {totalMod.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                        </td>
                      </tr>
                    );
                  })}
                  
                  {/* Sem Modulo */}
                  {(() => {
                    let totalSem = 0;
                    const rowCells = Array.from({ length: duracaoMeses }).map((_, i) => {
                      const m = i + 1;
                      let sumMes = 0;
                      itensProjeto.filter(it => !it.moduloId).forEach(it => {
                        const qty = (allocations[it.id] || {})[m] || 0;
                        sumMes += qty * it.valorUnitario;
                      });
                      totalSem += sumMes;
                      return (
                        <td key={m} className="px-4 py-4 text-right font-medium text-gray-700">
                          {sumMes > 0 ? sumMes.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '-'}
                        </td>
                      );
                    });

                    if (totalSem === 0) return null;

                    return (
                      <tr className="hover:bg-gray-50">
                        <td className="px-4 py-4 font-bold text-gray-500 sticky left-0 bg-white group-hover:bg-gray-50 transition-colors z-10 border-r">Sem Módulo</td>
                        {rowCells}
                        <td className="px-4 py-4 text-right font-black text-lie-ink bg-gray-50">
                          {totalSem.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                        </td>
                      </tr>
                    );
                  })()}
                </tbody>
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
                        {itensDoModulo.map(it => {
                          const master = itensMaster.find(m => m.id === it.itemId);
                          const distributed = calculateTotalDistributed(it.id);
                          const currentQty = (allocations[it.id] || {})[selectedTab as number] || 0;
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
                              <td className={`px-4 py-3 ${monthLocked[selectedTab as number] ? 'bg-gray-50' : 'bg-emerald-50/50'} border-l border-emerald-100`}>
                                <input 
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={currentQty || ''}
                                  onChange={(e) => handleQtyChange(it.id, selectedTab as number, e.target.value, it.quantidade)}
                                  disabled={monthLocked[selectedTab as number]}
                                  className={`w-full rounded text-center font-bold shadow-inner ${monthLocked[selectedTab as number] ? 'bg-gray-100 border-gray-200 text-gray-500' : 'border-emerald-200 focus:ring-emerald-500 focus:border-emerald-500 text-emerald-800'}`}
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
                        <tr className="bg-gray-50 border-t border-gray-200">
                          <td colSpan={6} className="px-4 py-2 text-right font-bold text-gray-500 text-xs">Subtotal Módulo:</td>
                          <td className="px-4 py-2 text-right font-bold text-lie-ink">
                            {itensDoModulo.reduce((acc, it) => acc + (((allocations[it.id] || {})[selectedTab as number] || 0) * it.valorUnitario), 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                          </td>
                        </tr>
                      </React.Fragment>
                    );
                  })}

                  {/* Itens sem Módulo */}
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
                        {semModulo.map(it => {
                          const master = itensMaster.find(m => m.id === it.itemId);
                          const distributed = calculateTotalDistributed(it.id);
                          const currentQty = (allocations[it.id] || {})[selectedTab as number] || 0;
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
                              <td className={`px-4 py-3 ${monthLocked[selectedTab as number] ? 'bg-gray-50' : 'bg-emerald-50/50'} border-l border-emerald-100`}>
                                <input 
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={currentQty || ''}
                                  onChange={(e) => handleQtyChange(it.id, selectedTab as number, e.target.value, it.quantidade)}
                                  disabled={monthLocked[selectedTab as number]}
                                  className={`w-full rounded text-center font-bold shadow-inner ${monthLocked[selectedTab as number] ? 'bg-gray-100 border-gray-200 text-gray-500' : 'border-emerald-200 focus:ring-emerald-500 focus:border-emerald-500 text-emerald-800'}`}
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
                        {modulos.length > 0 && (
                          <tr className="bg-gray-50 border-t border-gray-200">
                            <td colSpan={6} className="px-4 py-2 text-right font-bold text-gray-500 text-xs">Subtotal Sem Módulo:</td>
                            <td className="px-4 py-2 text-right font-bold text-lie-ink">
                              {semModulo.reduce((acc, it) => acc + (((allocations[it.id] || {})[selectedTab as number] || 0) * it.valorUnitario), 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })()}
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
