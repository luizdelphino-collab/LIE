import { useEffect, useState } from 'react';
import { collection, query, getDocs, doc, setDoc, deleteDoc, serverTimestamp, orderBy, Timestamp, limit } from 'firebase/firestore';
import { Plus, Search, Edit3, Trash2, ArrowUpDown, Loader2, ArrowLeft } from 'lucide-react';
import { db } from '../lib/firebase';
import type { ItemMaster, CategoriaItem, UnidadeMedida } from '../types';

const CATEGORIAS: CategoriaItem[] = ['Alimento', 'Transporte', 'Material Esportivo', 'Material não Esportivo', 'Recurso Humano', 'Outro'];
const UNIDADES: UnidadeMedida[] = ['diária', 'metro', 'metro²', 'unidade', 'pacote', 'caixa', 'kit', 'mês', 'Kg'];

export default function ItensMasterPage() {
  const [items, setItems] = useState<ItemMaster[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  // Estados para Ordenação
  const [sortField, setSortField] = useState<keyof ItemMaster>('categoria');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

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

      // Seed se estiver vazio
      if (list.length === 0) {
        await seedItems();
      }
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
    .filter(it => 
      it.nome.toLowerCase().includes(searchTerm.toLowerCase()) || 
      it.codigo.toString().includes(searchTerm) ||
      it.categoria.toLowerCase().includes(searchTerm.toLowerCase())
    )
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
      const id = editId || doc(collection(db, 'items')).id;
      
      let finalCodigo = formData.codigo;
      if (!editId) {
        // Pega o maior código atual
        const maxCodigo = items.length > 0 ? Math.max(...items.map(it => it.codigo)) : 0;
        finalCodigo = maxCodigo + 1;
      }

      await setDoc(doc(db, 'items', id), {
        ...formData,
        id,
        codigo: finalCodigo,
        criadoEm: formData.criadoEm || serverTimestamp()
      }, { merge: true });

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
    if (!confirm("Excluir este item permanentemente do banco de dados?")) return;
    try {
      await deleteDoc(doc(db, 'items', id));
      setItems(prev => prev.filter(it => it.id !== id));
    } catch (e) {
      console.error(e);
      alert("Erro ao excluir");
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
        <button onClick={openNew} className="inline-flex items-center gap-2 bg-lie-green hover:bg-lie-greenDark text-white font-bold px-4 py-2 rounded-lg shadow-sm transition">
          <Plus className="w-4 h-4" /> Novo Item Base
        </button>
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
        </table>
        {sortedItems.length === 0 && (
          <div className="p-12 text-center text-lie-gray italic">Nenhum item encontrado.</div>
        )}
      </div>
    </div>
  );
}
