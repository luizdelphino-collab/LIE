import { useEffect, useState } from 'react';
import { collection, query, getDocs, doc, setDoc, deleteDoc, serverTimestamp, orderBy, Timestamp, limit, where } from 'firebase/firestore';
import { Plus, Search, Edit3, Trash2, ArrowUpDown, Loader2, ArrowLeft, Upload, Download, FileSpreadsheet } from 'lucide-react';
import * as XLSX from 'xlsx';
import { db } from '../lib/firebase';
import type { ItemMaster, CategoriaItem, UnidadeMedida } from '../types';


const CATEGORIAS: CategoriaItem[] = ['Alimento', 'Transporte', 'Material Esportivo', 'Material não Esportivo', 'Recurso Humano', 'Outro'];
const UNIDADES: (UnidadeMedida | string)[] = ['diária', 'metro', 'metro²', 'unidade', 'pacote', 'caixa', 'kit', 'mês', 'Kg', 'evento', 'jogo', 'geral'];

export default function ItensMasterPage() {
  const [items, setItems] = useState<ItemMaster[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const [sortField, setSortField] = useState<keyof ItemMaster>('categoria');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [formData, setFormData] = useState<Partial<ItemMaster>>({
    nome: '',
    descricao: '',
    unidade: 'unidade',
    valorUnitario: 0,
    categoria: 'Alimento'
  });

  const carregarItens = async () => {
    try {
      setLoading(true);
      const q = query(collection(db, 'items'), orderBy('codigo', 'asc'));
      const snap = await getDocs(q);
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as ItemMaster));
      setItems(list);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const seedItems = async () => {
    const samples: Partial<ItemMaster>[] = [
      { nome: 'Arroz 5kg', categoria: 'Alimento', unidade: 'pacote', valorUnitario: 25.50 },
      { nome: 'Feijão 1kg', categoria: 'Alimento', unidade: 'unidade', valorUnitario: 8.90 },
      { nome: 'Ônibus fretado 40 lugares', categoria: 'Transporte', unidade: 'diária', valorUnitario: 1200 },
      { nome: 'Bola de Futebol Profissional', categoria: 'Material Esportivo', unidade: 'unidade', valorUnitario: 180 },
      { nome: 'Cone de treinamento', categoria: 'Material Esportivo', unidade: 'unidade', valorUnitario: 15 },
      { nome: 'Colete dupla face', categoria: 'Material Esportivo', unidade: 'unidade', valorUnitario: 35 },
      { nome: 'Papel A4 Resma', categoria: 'Material não Esportivo', unidade: 'pacote', valorUnitario: 28 },
      { nome: 'Coordenador Técnico', categoria: 'Recurso Humano', unidade: 'mês', valorUnitario: 4500 },
      { nome: 'Professor de Educação Física', categoria: 'Recurso Humano', unidade: 'mês', valorUnitario: 3200 },
      { nome: 'Garrafa de Água 500ml', categoria: 'Alimento', unidade: 'unidade', valorUnitario: 2.50 },
    ];

    let count = 1;
    for (const s of samples) {
      const id = doc(collection(db, 'items')).id;
      await setDoc(doc(db, 'items', id), {
        ...s,
        id,
        codigo: count++,
        criadoEm: serverTimestamp()
      });
    }
    carregarItens();
  };

  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    try {
      const dataBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(dataBuffer, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(sheet) as any[];

      if (jsonData.length === 0) {
        alert("A planilha está vazia!");
        setLoading(false);
        return;
      }



      const mapCategoria = (cat: string): string => {
        if (!cat) return 'Outro';
        const c = cat.trim().toLowerCase();
        if (c.includes('alimento')) return 'Alimento';
        if (c.includes('transporte')) return 'Transporte';
        if (c.includes('recurso humano') || c.includes('rh')) return 'Recurso Humano';
        if (c.includes('material não esportivo')) return 'Material não Esportivo';
        if (c.includes('material esportivo')) return 'Material Esportivo';
        return 'Outro';
      };

      const mapUnidade = (uni: string): string => {
        if (!uni) return 'unidade';
        const u = uni.trim().toLowerCase();
        if (u === 'unidade') return 'unidade';
        if (u === 'diária' || u === 'diaria') return 'diária';
        if (u === 'mês' || u === 'mes' || u === 'mensal') return 'mês';
        if (u === 'metro') return 'metro';
        if (u === 'm²' || u === 'metro²' || u === 'metro quadrado') return 'metro²';
        if (u === 'evento') return 'evento';
        if (u === 'jogo') return 'jogo';
        if (u === 'geral') return 'geral';
        if (u === 'pacote') return 'pacote';
        if (u === 'caixa') return 'caixa';
        if (u === 'kit') return 'kit';
        if (u === 'kg') return 'Kg';
        return u;
      };

      let count = items.length > 0 ? Math.max(...items.map(it => it.codigo)) : 0;
      count++;

      for (const row of jsonData) {
        const nome = row['Item'] || row['Nome'] || row['nome'] || row['item'];
        if (!nome) continue;

        const categoria = mapCategoria(row['Categoria'] || row['categoria']);
        const unidade = mapUnidade(row['Unidade'] || row['unidade']);
        const valorUnitario = parseFloat(row['Valor Unitário'] || row['valorUnitario'] || row['Valor'] || row['valor'] || 0);
        const descricao = row['Descrição'] || row['descricao'] || '';

        const id = doc(collection(db, 'items')).id;
        await setDoc(doc(db, 'items', id), {
          id,
          codigo: count++,
          nome,
          categoria,
          unidade,
          valorUnitario,
          descricao,
          criadoEm: serverTimestamp()
        });
      }

      alert("Importação concluída com sucesso!");
      carregarItens();
    } catch (err) {
      console.error(err);
      alert("Erro ao importar planilha. Verifique o formato do arquivo.");
    } finally {
      setLoading(false);
    }
  };



  useEffect(() => {
    carregarItens();
  }, []);

  const handleSort = (field: keyof ItemMaster) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const sortedItems = [...items]
    .filter(it => {
      const term = searchTerm.toLowerCase();
      return (
        (it.nome || '').toLowerCase().includes(term) || 
        (it.codigo || '').toString().includes(term) ||
        (it.categoria || '').toLowerCase().includes(term)
      );
    })
    .sort((a, b) => {
      let valA = a[sortField];
      let valB = b[sortField];

      if (typeof valA === 'string') valA = valA.toLowerCase();
      if (typeof valB === 'string') valB = valB.toLowerCase();

      if (valA! < valB!) return sortOrder === 'asc' ? -1 : 1;
      if (valA! > valB!) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      let isLinked = false;
      const id = editId || doc(collection(db, 'items')).id;
      
      let finalCodigo = formData.codigo;
      if (!editId) {
        // Pega o maior código atual
        const maxCodigo = items.length > 0 ? Math.max(...items.map(it => it.codigo)) : 0;
        finalCodigo = maxCodigo + 1;
      } else {
        const originalItem = items.find(it => it.id === editId);
        if (originalItem && (
          (originalItem.nome || '') !== (formData.nome || '') ||
          (originalItem.descricao || '') !== (formData.descricao || '') ||
          (originalItem.unidade || '') !== (formData.unidade || '') ||
          (originalItem.categoria || '') !== (formData.categoria || '') ||
          (originalItem.valorUnitario || 0) !== (formData.valorUnitario || 0)
        )) {
          const projectsSnap = await getDocs(collection(db, 'projects'));
          for (const p of projectsSnap.docs) {
            const itemsSnap = await getDocs(query(collection(db, `projects/${p.id}/items`), where('itemId', '==', editId)));
            if (!itemsSnap.empty) {
              isLinked = true;
              break;
            }
          }
        }
      }

      if (isLinked) {
        const confirmar = window.confirm(
          "Este item já está vinculado a um projeto e não pode sofrer alterações de escopo.\n" +
          "Se desejar continuar, será criado um novo item com as novas características.\n\n" +
          "Deseja criar um novo item?"
        );
        if (!confirmar) {
          setSaving(false);
          return;
        }

        const newId = doc(collection(db, 'items')).id;
        const maxCodigo = items.length > 0 ? Math.max(...items.map(it => it.codigo)) : 0;
        finalCodigo = maxCodigo + 1;

        await setDoc(doc(db, 'items', newId), {
          ...formData,
          id: newId,
          codigo: finalCodigo,
          criadoEm: serverTimestamp()
        });
      } else {
        await setDoc(doc(db, 'items', id), {
          ...formData,
          id,
          codigo: finalCodigo,
          criadoEm: formData.criadoEm || serverTimestamp()
        }, { merge: true });
      }

      setIsFormOpen(false);
      carregarItens();
    } catch (e) {
      console.error(e);
      alert("Erro ao salvar item");
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (it: ItemMaster) => {
    setEditId(it.id);
    setFormData({ ...it });
    setIsFormOpen(true);
  };

  const openNew = () => {
    setEditId(null);
    setFormData({ nome: '', descricao: '', unidade: 'unidade', valorUnitario: 0, categoria: 'Alimento' });
    setIsFormOpen(true);
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'items', id));
      setItems(prev => prev.filter(it => it.id !== id));
      setConfirmDeleteId(null);
    } catch (e) {
      console.error(e);
      alert("Erro ao excluir. Verifique as permissões do Firestore.");
    }
  };

  if (loading) return <div className="p-6 text-lie-gray">Carregando banco de itens...</div>;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-lie-ink">Banco de Dados de Itens</h1>
          <p className="text-sm text-lie-gray">Gerencie os itens base que serão utilizados nos projetos</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Download Model Button */}
          <a 
            href="/modelo_importacao_itens.xlsx" 
            download="modelo_importacao_itens.xlsx"
            className="group flex items-center bg-amber-50 border border-amber-200 text-amber-700 rounded-lg p-2 transition-all duration-300 hover:bg-amber-100 shadow-sm"
          >
            <Download className="w-5 h-5 shrink-0 text-amber-600" />
            <span className="max-w-0 opacity-0 group-hover:max-w-xs group-hover:opacity-100 group-hover:ml-2 whitespace-nowrap transition-all duration-300 ease-in-out font-medium text-sm">
              Baixar Modelo Excel
            </span>
          </a>

          {/* Import Batch Label */}
          <label className="group flex items-center bg-indigo-50 border border-indigo-200 text-indigo-700 rounded-lg p-2 cursor-pointer transition-all duration-300 hover:bg-indigo-100 shadow-sm">
            <FileSpreadsheet className="w-5 h-5 shrink-0 text-indigo-600" />
            <span className="max-w-0 opacity-0 group-hover:max-w-xs group-hover:opacity-100 group-hover:ml-2 whitespace-nowrap transition-all duration-300 ease-in-out font-medium text-sm">
              Importar Lote (Planilha)
            </span>
            <input
              type="file"
              accept=".xlsx, .xls"
              onChange={handleImportExcel}
              className="hidden"
            />
          </label>



          {/* New Item Button */}
          <button onClick={openNew} className="group flex items-center bg-lie-green text-white rounded-lg p-2 transition-all duration-300 overflow-hidden hover:bg-lie-greenDark shadow-sm">
            <Plus className="w-5 h-5 shrink-0" />
            <span className="max-w-0 opacity-0 group-hover:max-w-xs group-hover:opacity-100 group-hover:ml-2 whitespace-nowrap transition-all duration-300 ease-in-out font-medium text-sm">
              Novo Item Base
            </span>
          </button>
        </div>
      </header>

      <div className="mb-6 relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
        <input 
          type="text" 
          placeholder="Buscar por nome, código ou categoria..." 
          className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-xl shadow-sm focus:ring-lie-green focus:border-lie-green"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {isFormOpen && (
        <div className="bg-white rounded-xl shadow-premium p-6 border border-gray-100 mb-6 animate-fade-in">
          <h2 className="text-lg font-bold text-lie-ink mb-4">{editId ? 'Editar Item Base' : 'Cadastrar Novo Item Base'}</h2>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-bold text-gray-700 mb-1">Nome do Item *</label>
              <input type="text" required value={formData.nome} onChange={e => setFormData(p => ({...p, nome: e.target.value}))} className="w-full border-gray-300 rounded-lg shadow-sm" />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Categoria *</label>
              <select value={formData.categoria} onChange={e => setFormData(p => ({...p, categoria: e.target.value}))} className="w-full border-gray-300 rounded-lg shadow-sm">
                {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Unidade *</label>
              <select value={formData.unidade} onChange={e => setFormData(p => ({...p, unidade: e.target.value}))} className="w-full border-gray-300 rounded-lg shadow-sm">
                {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Valor Unitário (R$) *</label>
              <input type="number" step="0.01" required value={formData.valorUnitario} onChange={e => setFormData(p => ({...p, valorUnitario: parseFloat(e.target.value)}))} className="w-full border-gray-300 rounded-lg shadow-sm" />
            </div>
            <div className="md:col-span-3">
              <label className="block text-sm font-bold text-gray-700 mb-1">Descrição / Especificação</label>
              <textarea rows={2} value={formData.descricao} onChange={e => setFormData(p => ({...p, descricao: e.target.value}))} className="w-full border-gray-300 rounded-lg shadow-sm" />
            </div>
            <div className="md:col-span-3 flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setIsFormOpen(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium">Cancelar</button>
              <button type="submit" disabled={saving} className="bg-lie-green hover:bg-lie-greenDark text-white px-8 py-2 rounded-lg font-bold shadow-sm flex items-center gap-2">
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {saving ? 'Salvando...' : 'Salvar no Banco'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-premium overflow-hidden border border-gray-100">
        <table className="w-full text-left">
          <thead className="bg-gray-50 text-xs font-bold text-lie-gray uppercase border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('categoria')}>
                <div className="flex items-center gap-1">Categoria <ArrowUpDown className="w-3 h-3" /></div>
              </th>
              <th className="px-4 py-3 w-20 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('codigo')}>
                <div className="flex items-center gap-1">Nº <ArrowUpDown className="w-3 h-3" /></div>
              </th>
              <th className="px-4 py-3 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('nome')}>
                <div className="flex items-center gap-1">Item <ArrowUpDown className="w-3 h-3" /></div>
              </th>
              <th className="px-4 py-3">Descritivo</th>
              <th className="px-4 py-3 w-24 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('unidade')}>
                <div className="flex items-center gap-1">Unidade <ArrowUpDown className="w-3 h-3" /></div>
              </th>
              <th className="px-4 py-3 w-32 text-right cursor-pointer hover:bg-gray-100" onClick={() => handleSort('valorUnitario')}>
                <div className="flex items-center gap-1 justify-end">$ Unitário <ArrowUpDown className="w-3 h-3" /></div>
              </th>
              <th className="px-4 py-3 w-24 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sortedItems.map(it => (
              <tr key={it.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3">
                  <span className="text-[10px] font-bold px-2 py-0.5 bg-gray-100 rounded-full text-gray-600 uppercase">{it.categoria}</span>
                </td>
                <td className="px-4 py-3 text-sm font-mono text-gray-500">#{String(it.codigo).padStart(3, '0')}</td>
                <td className="px-4 py-3 font-bold text-lie-ink">{it.nome}</td>
                <td className="px-4 py-3 text-xs text-gray-500 max-w-xs truncate">{it.descricao || '-'}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{it.unidade}</td>
                <td className="px-4 py-3 text-sm font-bold text-right text-lie-ink">
                  {it.valorUnitario.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    {confirmDeleteId === it.id ? (
                      <>
                        <span className="text-xs text-red-600 font-semibold mr-1">Excluir?</span>
                        <button
                          onClick={() => handleDelete(it.id)}
                          className="px-2 py-1 bg-red-500 text-white text-xs font-bold rounded hover:bg-red-600 transition"
                        >
                          Sim
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="px-2 py-1 bg-gray-200 text-gray-700 text-xs font-bold rounded hover:bg-gray-300 transition"
                        >
                          Não
                        </button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => openEdit(it)} className="p-1.5 text-lie-ink hover:bg-gray-100 rounded transition" title="Editar">
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button onClick={() => setConfirmDeleteId(it.id)} className="p-1.5 text-red-500 hover:bg-red-50 rounded transition" title="Excluir">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {sortedItems.length === 0 && (
          <div className="p-12 text-center text-lie-gray italic">Nenhum item encontrado.</div>
        )}
      </div>
    </div>
  );
}
