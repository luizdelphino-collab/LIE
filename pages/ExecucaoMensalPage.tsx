import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { collection, query, getDocs, doc, getDoc, setDoc, orderBy } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { ArrowLeft, Save, Loader2, Users, CalendarDays, Send, Paperclip, CheckCircle2, Edit3, FileSpreadsheet } from 'lucide-react';
import { db, storage } from '../lib/firebase';
import * as XLSX from 'xlsx';
import type { ItemProjeto, Projeto, Fornecedor, ExecucaoMensal, ExecucaoMensalItem, CronogramaItem, ExecucaoMensalItemFornecedor } from '../types';

const formatMoney = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function ExecucaoMensalPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [projeto, setProjeto] = useState<Projeto | null>(null);
  const [itensProjeto, setItensProjeto] = useState<ItemProjeto[]>([]);
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [execucao, setExecucao] = useState<ExecucaoMensal | null>(null);
  const [cronograma, setCronograma] = useState<CronogramaItem[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);

  const [selectedMonth, setSelectedMonth] = useState<number>(1);
  const duracaoMeses = projeto?.duracaoMeses || 12;

  // Local state for the current month execution items
  const [mensalItems, setMensalItems] = useState<Record<string, ExecucaoMensalItem>>({});

  const carregarDados = async () => {
    if (!id) return;
    try {
      setLoading(true);
      const pSnap = await getDoc(doc(db, 'projects', id));
      if (pSnap.exists()) setProjeto({ id: pSnap.id, ...pSnap.data() } as Projeto);

      const [snapItems, snapForn, snapCron] = await Promise.all([
        getDocs(query(collection(db, `projects/${id}/items`), orderBy('criadoEm', 'asc'))),
        getDocs(collection(db, 'suppliers')),
        getDocs(collection(db, `projects/${id}/cronograma`))
      ]);

      const projItems = snapItems.docs.map(d => ({ id: d.id, ...d.data() } as ItemProjeto));
      setItensProjeto(projItems);
      setFornecedores(snapForn.docs.map(d => ({ id: d.id, ...d.data() } as Fornecedor)));
      setCronograma(snapCron.docs.map(d => ({ id: d.id, ...d.data() } as CronogramaItem)));

      await carregarMes(selectedMonth, projItems);

    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const carregarMes = async (mes: number, pItens: ItemProjeto[] = itensProjeto) => {
    if (!id) return;
    try {
      const docRef = doc(db, `projects/${id}/execucao`, `mes_${mes}`);
      const snap = await getDoc(docRef);
      
      const newMensalItems: Record<string, ExecucaoMensalItem> = {};

      if (snap.exists()) {
        const data = snap.data() as ExecucaoMensal;
        setExecucao(data);
        data.itens.forEach(it => {
          newMensalItems[it.itemProjetoId] = it;
        });
      } else {
        setExecucao({
          id: `mes_${mes}`,
          projectId: id,
          mes: mes,
          status: 'pendente',
          itens: []
        });
      }

      // Fill missing items / suppliers
      pItens.forEach(it => {
        if (!newMensalItems[it.id]) {
          const fornecedoresExecucao = (it.fornecedoresIds || []).map(fid => ({
            fornecedorId: fid,
            quantidade: 0
          }));
          newMensalItems[it.id] = { itemProjetoId: it.id, fornecedoresExecucao };
        } else {
          // If item exists, ensure all linked suppliers are there
          const existingIds = newMensalItems[it.id].fornecedoresExecucao?.map(f => f.fornecedorId) || [];
          const updatedForns = [...(newMensalItems[it.id].fornecedoresExecucao || [])];
          
          (it.fornecedoresIds || []).forEach(fid => {
            if (!existingIds.includes(fid)) {
              updatedForns.push({ fornecedorId: fid, quantidade: 0 });
            }
          });
          newMensalItems[it.id].fornecedoresExecucao = updatedForns;
        }
      });

      setMensalItems(newMensalItems);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    carregarDados();
  }, [id]);

  useEffect(() => {
    if (itensProjeto.length > 0) {
      carregarMes(selectedMonth);
    }
  }, [selectedMonth]);

  const handleQtyChange = (itemId: string, fornId: string, val: string) => {
    let q = parseFloat(val);
    if (isNaN(q) || q < 0) q = 0;
    
    setMensalItems(prev => {
      const copy = { ...prev };
      const item = { ...copy[itemId] };
      item.fornecedoresExecucao = item.fornecedoresExecucao.map(f => 
        f.fornecedorId === fornId ? { ...f, quantidade: q } : f
      );
      copy[itemId] = item;
      return copy;
    });
  };

  const handleConsolidar = async () => {
    if (!id || !execucao) return;
    
    // Check if there's any execution at all
    let hasExecution = false;
    Object.values(mensalItems).forEach(mi => {
      if (mi.fornecedoresExecucao?.some(f => f.quantidade > 0)) hasExecution = true;
    });

    if (!hasExecution) {
      alert("Nenhuma quantidade executada informada para este mês.");
      return;
    }

    if (!confirm("Deseja consolidar o mês? Isso travará os lançamentos e enviará um e-mail com as ordens para emissão de NF aos fornecedores.")) return;

    setSaving(true);
    try {
      const execDoc: ExecucaoMensal = {
        ...execucao,
        status: 'consolidado',
        itens: Object.values(mensalItems),
        consolidadoEm: new Date() as any
      };

      await setDoc(doc(db, `projects/${id}/execucao`, `mes_${selectedMonth}`), execDoc);
      setExecucao(execDoc);

      // Simular envio de e-mail por fornecedor
      const reports = new Map<string, string>(); // fornecedorId -> texto do relatorio
      
      Object.values(mensalItems).forEach(mi => {
        const pItem = itensProjeto.find(i => i.id === mi.itemProjetoId);
        if (!pItem) return;

        mi.fornecedoresExecucao.forEach(fe => {
          if (fe.quantidade > 0) {
            let currentText = reports.get(fe.fornecedorId) || '';
            currentText += `\n- Cód. ${pItem.itemId.substring(0,6)} | ${pItem.nome}\n  Memória: ${pItem.memorialCalculo || '-'}\n  Qtd Fornecida: ${fe.quantidade} ${pItem.unidade}\n  Val. Unit: ${formatMoney(pItem.valorUnitario)}\n  Total: ${formatMoney(fe.quantidade * pItem.valorUnitario)}\n`;
            reports.set(fe.fornecedorId, currentText);
          }
        });
      });

      let emailsSimulados = '';
      reports.forEach((text, fid) => {
        const forn = fornecedores.find(f => f.id === fid);
        if (forn?.email) {
          emailsSimulados += `\n\n=== E-MAIL PARA: ${forn.razaoSocial} (${forn.email}) ===\nFavor providenciar NFs para o Mês ${selectedMonth} do projeto ${projeto?.titulo}:\n${text}`;
        }
      });

      console.log(emailsSimulados);
      alert(`Mês Consolidado com Sucesso!\nE-mails de solicitação disparados virtualmente (verifique o console para ler o conteúdo).`);

    } catch (err) {
      console.error(err);
      alert("Erro ao consolidar mês.");
    } finally {
      setSaving(false);
    }
  };

  const handleEditarMes = async () => {
    if (!confirm("Tem certeza que deseja reabrir a edição? Isso permitirá alterar as quantidades consolidadas.")) return;
    setSaving(true);
    try {
      const execDoc: ExecucaoMensal = {
        ...execucao!,
        status: 'pendente'
      };
      await setDoc(doc(db, `projects/${id}/execucao`, `mes_${selectedMonth}`), execDoc);
      setExecucao(execDoc);
    } catch (err) {
      console.error(err);
      alert("Erro ao reabrir mês.");
    } finally {
      setSaving(false);
    }
  };

  const handleFileUpload = async (itemId: string, fornId: string, field: 'notaFiscalUrl' | 'comprovanteUrl' | 'extratoBancarioUrl', file: File) => {
    if (!id) return;
    setUploading(`${itemId}-${fornId}-${field}`);
    try {
      const storageRef = ref(storage, `execucao/${id}/mes_${selectedMonth}/${itemId}_${fornId}_${field}_${Date.now()}_${file.name}`);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);

      const newMensalItems = { ...mensalItems };
      const item = { ...newMensalItems[itemId] };
      item.fornecedoresExecucao = item.fornecedoresExecucao.map(f => 
        f.fornecedorId === fornId ? { ...f, [field]: url } : f
      );
      newMensalItems[itemId] = item;
      setMensalItems(newMensalItems);

      // Save instantly
      const execDoc: ExecucaoMensal = {
        ...execucao!,
        itens: Object.values(newMensalItems)
      };
      await setDoc(doc(db, `projects/${id}/execucao`, `mes_${selectedMonth}`), execDoc);
      setExecucao(execDoc);

    } catch (err) {
      console.error(err);
      alert("Erro ao enviar arquivo.");
    } finally {
      setUploading(null);
    }
  };

  const handleExport = () => {
    const headers = [
      'Cód Item', 'Item', 'Unidade', 
      'Fornecedor', 'Qtd Executada (Empresa)', 'Valor Total (Empresa)',
      'Qtd Total Mês (Item)', 'Valor Total Mês (Item)'
    ];

    const rows: any[][] = [];

    itensProjeto.forEach(it => {
      const execItem = mensalItems[it.id];
      const fornsExec = execItem?.fornecedoresExecucao || [];
      const totalQtdMes = fornsExec.reduce((acc, f) => acc + (f.quantidade || 0), 0);
      const totalValMes = totalQtdMes * it.valorUnitario;

      if (fornsExec.length === 0) {
        rows.push([it.itemId.substring(0,6), it.nome, it.unidade, '-', 0, 0, 0, 0]);
        return;
      }

      fornsExec.forEach(fe => {
        const forn = fornecedores.find(f => f.id === fe.fornecedorId);
        const valEmpresa = (fe.quantidade || 0) * it.valorUnitario;
        rows.push([
          it.itemId.substring(0,6),
          it.nome,
          it.unidade,
          forn?.razaoSocial || 'Desconhecido',
          fe.quantidade || 0,
          valEmpresa,
          totalQtdMes,
          totalValMes
        ]);
      });
    });

    const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    worksheet['!cols'] = [{ wch: 10 }, { wch: 40 }, { wch: 10 }, { wch: 30 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 20 }];
    
    // Formatting currency
    for (let r = 1; r <= rows.length; r++) {
      let cell = worksheet[XLSX.utils.encode_cell({ r, c: 5 })];
      if (cell && typeof cell.v === 'number') cell.z = '"R$ "#,##0.00';
      cell = worksheet[XLSX.utils.encode_cell({ r, c: 7 })];
      if (cell && typeof cell.v === 'number') cell.z = '"R$ "#,##0.00';
    }

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, `Mês ${selectedMonth}`);

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
      a.download = `execucao_mes_${selectedMonth}_${projeto?.titulo || 'lie'}.xlsx`;
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

  const isConsolidado = execucao?.status === 'consolidado';

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
            className="px-6 py-3 border-b-2 border-transparent text-gray-500 hover:text-gray-700 font-bold text-sm flex items-center gap-2 transition"
          >
            <Users className="w-4 h-4" /> Indicação de Fornecedores
          </Link>
          <Link 
            to={`/execucao/${id}/mensal`}
            className="px-6 py-3 border-b-2 font-bold text-sm flex items-center gap-2 border-lie-green text-lie-green"
          >
            <CalendarDays className="w-4 h-4" /> Lançamentos Mensais
          </Link>
        </div>
      </header>

      {/* Month Selector */}
      <div className="flex items-center gap-2 overflow-x-auto pb-4 mb-6 scrollbar-thin">
        {Array.from({ length: duracaoMeses }).map((_, i) => {
          const m = i + 1;
          const isSelected = selectedMonth === m;
          return (
            <button
              key={m}
              onClick={() => setSelectedMonth(m)}
              className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-bold transition-colors ${
                isSelected 
                  ? 'bg-lie-ink text-white shadow-md' 
                  : 'bg-white text-gray-500 border border-gray-200 hover:bg-gray-50'
              }`}
            >
              Mês {m}
            </button>
          );
        })}
      </div>

      <div className="bg-white rounded-xl shadow-premium border border-gray-100 p-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
          <div>
            <h2 className="text-lg font-bold text-lie-ink flex items-center gap-2">
              Lançamentos Físicos e Financeiros — Mês {selectedMonth}
              {isConsolidado && <span className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded font-bold uppercase">Consolidado</span>}
            </h2>
            <p className="text-sm text-gray-500">
              {isConsolidado 
                ? "Mês consolidado. Insira as Notas Fiscais, Comprovantes e Extratos." 
                : "Indique a quantidade executada para cada fornecedor neste mês para gerar a consolidação."}
            </p>
          </div>
          <div className="flex gap-2">
            {isConsolidado && (
              <>
                <button 
                  onClick={handleExport}
                  className="inline-flex items-center gap-2 bg-white border border-gray-300 text-green-700 hover:bg-green-50 font-medium px-4 py-2 rounded-lg shadow-sm transition"
                >
                  <FileSpreadsheet className="w-4 h-4" /> Exportar Mês
                </button>
                <button 
                  onClick={handleEditarMes}
                  disabled={saving}
                  className="inline-flex items-center gap-2 bg-white border border-gray-300 text-blue-600 hover:bg-blue-50 font-bold px-4 py-2 rounded-lg shadow-sm transition disabled:opacity-50"
                >
                  <Edit3 className="w-4 h-4" /> Editar Mês
                </button>
              </>
            )}
            {!isConsolidado && (
              <button 
                onClick={handleConsolidar}
                disabled={saving}
                className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white font-bold px-6 py-2 rounded-lg shadow-sm transition disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Consolidar Mês
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[1000px]">
            <tbody className="divide-y-4 divide-white border-t border-gray-200">
              {itensProjeto.map(it => {
                const execItem = mensalItems[it.id];
                const fornsExec = execItem?.fornecedoresExecucao || [];
                
                const cronItem = cronograma.find(c => c.itemProjetoId === it.id && c.mes === selectedMonth);
                const previstoMes = cronItem?.quantidade || 0;

                const totalQtyMes = fornsExec.reduce((acc, f) => acc + (f.quantidade || 0), 0);
                const totalValMes = totalQtyMes * it.valorUnitario;

                return (
                  <React.Fragment key={it.id}>
                    {/* Linha do ITEM (Agrupador) */}
                    <tr className="bg-gray-100 border-b border-gray-200">
                      <td colSpan={isConsolidado ? 7 : 4} className="px-4 py-3">
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                          <div>
                            <span className="font-bold text-lie-ink text-sm block md:inline">{it.nome}</span>
                            <span className="md:ml-3 text-[11px] text-gray-500 font-medium block md:inline mt-1 md:mt-0">
                              Unidade: <span className="text-gray-800">{it.unidade}</span> | 
                              Previsto Mês: <span className="text-gray-800">{previstoMes}</span> | 
                              Unitário: <span className="text-gray-800">{formatMoney(it.valorUnitario)}</span> | 
                              Total Proj: <span className="text-gray-800">{it.quantidade}</span>
                            </span>
                          </div>
                          <div className="text-xs font-bold text-blue-800 bg-blue-100 px-3 py-1 rounded">
                            Resumo Mês: {totalQtyMes} executado ({formatMoney(totalValMes)})
                          </div>
                        </div>
                      </td>
                    </tr>
                    
                    {/* Linhas de FORNECEDORES para o item */}
                    {fornsExec.length === 0 ? (
                      <tr>
                        <td colSpan={isConsolidado ? 7 : 4} className="px-4 py-4 text-center text-amber-600 text-xs font-medium bg-gray-50">
                          Nenhum fornecedor foi indicado para este item na aba "Indicação de Fornecedores".
                        </td>
                      </tr>
                    ) : (
                      <>
                        <tr className="bg-white border-b border-gray-100 text-[10px] font-bold text-gray-400 uppercase">
                          <td className="px-4 py-2 pl-8">Fornecedor</td>
                          <td className="px-4 py-2 text-center w-32 bg-blue-50/30 border-l border-blue-50">Qtd Executada</td>
                          <td className="px-4 py-2 text-right w-40 bg-blue-50/30 border-r border-blue-50">$ Total</td>
                          {isConsolidado && (
                            <>
                              <td className="px-4 py-2">Nota Fiscal</td>
                              <td className="px-4 py-2">Comprovante</td>
                              <td className="px-4 py-2">Extrato Bancário</td>
                            </>
                          )}
                        </tr>
                        {fornsExec.map(fe => {
                          const forn = fornecedores.find(x => x.id === fe.fornecedorId);
                          const qty = fe.quantidade || 0;
                          const valForn = qty * it.valorUnitario;

                          const renderUploadField = (field: 'notaFiscalUrl' | 'comprovanteUrl' | 'extratoBancarioUrl', label: string) => {
                            const url = fe[field];
                            return (
                              <td className="px-4 py-3 text-xs border-l border-gray-100 w-48">
                                {qty > 0 ? (
                                  <div className="flex flex-col gap-2">
                                    {url ? (
                                      <a href={url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline flex items-center gap-1 font-bold truncate max-w-[120px]">
                                        <CheckCircle2 className="w-3 h-3 text-green-500 shrink-0" /> Ver {label}
                                      </a>
                                    ) : (
                                      <div className="text-red-500 font-medium italic">Pendente</div>
                                    )}
                                    <label className="cursor-pointer inline-flex items-center justify-center gap-1 text-[10px] uppercase font-bold text-lie-gray hover:text-lie-ink bg-gray-100 px-2 py-1.5 rounded transition">
                                      {uploading === `${it.id}-${fe.fornecedorId}-${field}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Paperclip className="w-3 h-3" />}
                                      Anexar
                                      <input type="file" accept=".pdf,image/*" className="hidden" onChange={(e) => {
                                        if (e.target.files && e.target.files[0]) handleFileUpload(it.id, fe.fornecedorId, field, e.target.files[0]);
                                      }} />
                                    </label>
                                  </div>
                                ) : (
                                  <span className="text-gray-300">-</span>
                                )}
                              </td>
                            );
                          };

                          return (
                            <tr key={fe.fornecedorId} className="bg-white border-b border-gray-50 hover:bg-gray-50/50">
                              <td className="px-4 py-3 pl-8 text-sm font-bold text-gray-700">
                                <span className="text-gray-400 font-normal mr-2">└</span>
                                {forn?.razaoSocial || 'Fornecedor Desconhecido'}
                              </td>
                              <td className={`px-4 py-3 w-32 border-l border-blue-100 ${isConsolidado ? 'bg-gray-50/50' : 'bg-blue-50/30'}`}>
                                {isConsolidado ? (
                                  <div className="text-center font-black text-lie-ink">{qty}</div>
                                ) : (
                                  <input 
                                    type="number"
                                    min="0"
                                    max={it.quantidade} // Pode ser melhorado para somar as qtds de todos os forns
                                    step="0.01"
                                    value={qty === 0 ? '' : qty}
                                    onChange={(e) => handleQtyChange(it.id, fe.fornecedorId, e.target.value)}
                                    className="w-full border-blue-200 rounded text-center focus:ring-blue-500 focus:border-blue-500 font-bold text-blue-800 shadow-inner py-1"
                                    placeholder="0"
                                  />
                                )}
                              </td>
                              <td className={`px-4 py-3 w-40 text-right font-bold text-sm ${valForn > 0 ? 'text-blue-700' : 'text-gray-400'} border-r border-blue-100 ${isConsolidado ? 'bg-gray-50/50' : 'bg-blue-50/30'}`}>
                                {formatMoney(valForn)}
                              </td>
                              {isConsolidado && (
                                <>
                                  {renderUploadField('notaFiscalUrl', 'NF')}
                                  {renderUploadField('comprovanteUrl', 'Pag')}
                                  {renderUploadField('extratoBancarioUrl', 'Extrato')}
                                </>
                              )}
                            </tr>
                          );
                        })}
                      </>
                    )}
                  </React.Fragment>
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
