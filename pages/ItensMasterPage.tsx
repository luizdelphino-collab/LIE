import { useEffect, useState } from 'react';
import { collection, query, getDocs, doc, setDoc, deleteDoc, serverTimestamp, orderBy, Timestamp, limit, writeBatch } from 'firebase/firestore';
import { Plus, Search, Edit3, Trash2, ArrowUpDown, Loader2, ArrowLeft, Upload, Download, FileSpreadsheet, Wand2, X, CheckCircle2, AlertTriangle, ShieldAlert } from 'lucide-react';
import * as XLSX from 'xlsx';
import { db } from '../lib/firebase';
import type { ItemMaster, CategoriaItem, UnidadeMedida } from '../types';

interface ItemComUso extends ItemMaster {
  projetosUsando: number;
}

interface GrupoDuplicata {
  nomeNormalizado: string;
  paraManter: ItemComUso[];
  paraExcluir: ItemComUso[];
}

function normalizarNome(s: string): string {
  return (s || '')
    .toUpperCase()
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}


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

  // Estado do limpador de duplicatas
  const [limpezaOpen, setLimpezaOpen] = useState(false);
  const [analisando, setAnalisando] = useState(false);
  const [grupos, setGrupos] = useState<GrupoDuplicata[]>([]);
  const [backupBaixado, setBackupBaixado] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [excluidos, setExcluidos] = useState<number | null>(null);

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
    try {
      await deleteDoc(doc(db, 'items', id));
      setItems(prev => prev.filter(it => it.id !== id));
      setConfirmDeleteId(null);
    } catch (e) {
      console.error(e);
      alert("Erro ao excluir. Verifique as permissões do Firestore.");
    }
  };

  const abrirLimpeza = async () => {
    setLimpezaOpen(true);
    setBackupBaixado(false);
    setExcluidos(null);
    setGrupos([]);
    setAnalisando(true);
    try {
      // 1. Carregar todos masters
      const mastersSnap = await getDocs(collection(db, 'items'));
      const masters = mastersSnap.docs.map(d => ({ id: d.id, ...d.data() } as ItemMaster));

      // 2. Cruzar com itens dos projetos
      const projectsSnap = await getDocs(collection(db, 'projects'));
      const usoPorItemId = new Map<string, Set<string>>();
      await Promise.all(
        projectsSnap.docs.map(async (projSnap) => {
          const itemsSnap = await getDocs(collection(db, `projects/${projSnap.id}/items`));
          itemsSnap.docs.forEach(d => {
            const data = d.data() as any;
            const refId: string | undefined = data.itemId || data.itemMasterId;
            if (refId) {
              if (!usoPorItemId.has(refId)) usoPorItemId.set(refId, new Set());
              usoPorItemId.get(refId)!.add(projSnap.id);
            }
          });
        })
      );

      // 3. Agrupar por nome normalizado
      const mapa = new Map<string, ItemComUso[]>();
      masters.forEach(m => {
        const k = normalizarNome(m.nome);
        if (!k) return;
        if (!mapa.has(k)) mapa.set(k, []);
        mapa.get(k)!.push({ ...m, projetosUsando: (usoPorItemId.get(m.id) || new Set()).size });
      });

      // 4. Decidir manter/excluir
      const resultado: GrupoDuplicata[] = [];
      mapa.forEach((itens, k) => {
        if (itens.length <= 1) return;
        const emUso = itens.filter(it => it.projetosUsando > 0);
        const orfaos = itens.filter(it => it.projetosUsando === 0);
        let paraManter: ItemComUso[];
        let paraExcluir: ItemComUso[];
        if (emUso.length > 0) {
          paraManter = emUso;
          paraExcluir = orfaos;
        } else {
          const ord = itens.slice().sort((a, b) => (a.codigo || 0) - (b.codigo || 0));
          paraManter = [ord[0]];
          paraExcluir = ord.slice(1);
        }
        if (paraExcluir.length > 0) {
          resultado.push({ nomeNormalizado: k, paraManter, paraExcluir });
        }
      });

      resultado.sort((a, b) => a.nomeNormalizado.localeCompare(b.nomeNormalizado));
      setGrupos(resultado);
    } catch (e: any) {
      console.error(e);
      alert(`Erro ao analisar duplicatas: ${e?.message || e}`);
    } finally {
      setAnalisando(false);
    }
  };

  const baixarBackup = async () => {
    try {
      const snap = await getDocs(collection(db, 'items'));
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const json = JSON.stringify({
        exportadoEm: new Date().toISOString(),
        total: data.length,
        items: data
      }, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      a.href = url;
      a.download = `items-backup-${ts}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setBackupBaixado(true);
    } catch (e: any) {
      alert(`Erro ao baixar backup: ${e?.message || e}`);
    }
  };

  const executarExclusao = async () => {
    const total = grupos.reduce((acc, g) => acc + g.paraExcluir.length, 0);
    if (!backupBaixado) {
      alert('Baixe o backup antes de excluir.');
      return;
    }
    if (!confirm(`Excluir definitivamente ${total} item(s) duplicado(s)? Esta ação NÃO pode ser desfeita.`)) return;
    if (!confirm('CONFIRMAÇÃO FINAL: a exclusão é permanente. Continuar?')) return;

    setExcluindo(true);
    try {
      const idsExcluir = grupos.flatMap(g => g.paraExcluir.map(it => it.id));
      // Firestore writeBatch suporta até 500 ops; particiona se preciso
      for (let i = 0; i < idsExcluir.length; i += 400) {
        const batch = writeBatch(db);
        idsExcluir.slice(i, i + 400).forEach(id => {
          batch.delete(doc(db, 'items', id));
        });
        await batch.commit();
      }
      setExcluidos(idsExcluir.length);
      await carregarItens();
    } catch (e: any) {
      alert(`Erro ao excluir: ${e?.message || e}`);
    } finally {
      setExcluindo(false);
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



          {/* Limpar Duplicatas */}
          <button
            onClick={abrirLimpeza}
            title="Limpar itens duplicados (mantém os em uso por projetos)"
            className="group flex items-center bg-red-50 border border-red-200 text-red-700 rounded-lg p-2 transition-all duration-300 hover:bg-red-100 shadow-sm"
          >
            <Wand2 className="w-5 h-5 shrink-0 text-red-600" />
            <span className="max-w-0 opacity-0 group-hover:max-w-xs group-hover:opacity-100 group-hover:ml-2 whitespace-nowrap transition-all duration-300 ease-in-out font-medium text-sm">
              Limpar Duplicatas
            </span>
          </button>

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

      {/* ===== MODAL DE LIMPEZA DE DUPLICATAS ===== */}
      {limpezaOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden animate-zoom-in">
            <header className="bg-lie-ink p-4 flex items-center justify-between text-white">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-red-500 rounded-lg">
                  <Wand2 className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="font-bold">Limpar Itens Duplicados</h3>
                  <p className="text-xs text-gray-300">
                    {analisando ? 'Analisando banco de itens e cruzando com projetos…' :
                     excluidos !== null ? `Concluído: ${excluidos} item(s) excluído(s).` :
                     grupos.length === 0 ? 'Nenhum grupo de duplicatas encontrado.' :
                     `${grupos.length} grupo(s) de duplicatas — ${grupos.reduce((a, g) => a + g.paraExcluir.length, 0)} item(s) serão excluídos.`}
                  </p>
                </div>
              </div>
              {!analisando && !excluindo && (
                <button onClick={() => setLimpezaOpen(false)} className="hover:bg-white/10 p-2 rounded-full">
                  <X className="w-5 h-5" />
                </button>
              )}
            </header>

            <div className="p-6 overflow-y-auto flex-1 space-y-4">
              {analisando && (
                <div className="flex flex-col items-center py-10 text-gray-500">
                  <Loader2 className="w-8 h-8 animate-spin text-red-500 mb-3" />
                  <p className="text-sm">Carregando masters e percorrendo projetos…</p>
                </div>
              )}

              {!analisando && excluidos === null && grupos.length === 0 && (
                <div className="p-6 text-center text-green-700 bg-green-50 border border-green-200 rounded-xl">
                  <CheckCircle2 className="w-10 h-10 mx-auto mb-2 text-green-600" />
                  <p className="font-bold">Banco está limpo!</p>
                  <p className="text-xs mt-1">Nenhum grupo de itens com mesmo nome foi encontrado.</p>
                </div>
              )}

              {!analisando && excluidos === null && grupos.length > 0 && (
                <>
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900 flex gap-2 leading-relaxed">
                    <ShieldAlert className="w-5 h-5 shrink-0 text-amber-600" />
                    <div>
                      <strong>Regra aplicada:</strong> itens com mesmo nome (normalizado) são considerados
                      duplicatas. Pra cada grupo:
                      <ul className="list-disc ml-5 mt-1 space-y-0.5">
                        <li>Se houver pelo menos 1 em uso por projetos → mantém todos os em uso, exclui órfãos.</li>
                        <li>Se nenhum estiver em uso → mantém o de menor código, exclui o resto.</li>
                      </ul>
                    </div>
                  </div>

                  <div className="space-y-3 max-h-[45vh] overflow-y-auto pr-1">
                    {grupos.map((g) => (
                      <div key={g.nomeNormalizado} className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                        <div className="font-bold text-sm text-lie-ink mb-2">{g.nomeNormalizado}</div>
                        <div className="space-y-1">
                          {g.paraManter.map(it => (
                            <div key={it.id} className="flex items-center gap-2 text-xs bg-green-50 border border-green-200 rounded px-2 py-1.5">
                              <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                              <span className="font-mono text-gray-500">#{String(it.codigo || 0).padStart(3, '0')}</span>
                              <span className="flex-1 truncate">{it.nome} · {it.unidade}</span>
                              <span className="text-[10px] font-bold uppercase text-green-700 bg-green-100 px-1.5 py-0.5 rounded">
                                {it.projetosUsando > 0 ? `Em uso (${it.projetosUsando})` : 'Mantido (menor #)'}
                              </span>
                            </div>
                          ))}
                          {g.paraExcluir.map(it => (
                            <div key={it.id} className="flex items-center gap-2 text-xs bg-red-50 border border-red-200 rounded px-2 py-1.5">
                              <Trash2 className="w-4 h-4 text-red-600 shrink-0" />
                              <span className="font-mono text-gray-500">#{String(it.codigo || 0).padStart(3, '0')}</span>
                              <span className="flex-1 truncate">{it.nome} · {it.unidade}</span>
                              <span className="text-[10px] font-bold uppercase text-red-700 bg-red-100 px-1.5 py-0.5 rounded">
                                Excluir
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {excluidos !== null && (
                <div className="p-6 text-center text-green-700 bg-green-50 border border-green-200 rounded-xl">
                  <CheckCircle2 className="w-10 h-10 mx-auto mb-2 text-green-600" />
                  <p className="font-bold">{excluidos} item(s) excluído(s) com sucesso!</p>
                  <p className="text-xs mt-1">O backup JSON foi baixado antes da exclusão.</p>
                </div>
              )}
            </div>

            {!analisando && excluidos === null && grupos.length > 0 && (
              <div className="p-4 bg-gray-50 border-t flex flex-wrap gap-3 items-center justify-between">
                <button
                  onClick={baixarBackup}
                  className={`flex items-center gap-2 px-4 py-2 font-bold rounded-lg transition ${
                    backupBaixado ? 'bg-green-100 text-green-800 border border-green-300' : 'bg-amber-500 text-white hover:bg-amber-600'
                  }`}
                >
                  {backupBaixado ? <CheckCircle2 className="w-4 h-4" /> : <Download className="w-4 h-4" />}
                  {backupBaixado ? 'Backup baixado' : 'Baixar backup JSON'}
                </button>
                <div className="flex gap-2">
                  <button
                    onClick={() => setLimpezaOpen(false)}
                    className="px-4 py-2 font-bold text-gray-600 hover:bg-gray-100 rounded-lg"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={executarExclusao}
                    disabled={!backupBaixado || excluindo}
                    className="flex items-center gap-2 px-5 py-2 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700 transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {excluindo ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    {excluindo ? 'Excluindo…' : `Excluir ${grupos.reduce((a, g) => a + g.paraExcluir.length, 0)} item(s)`}
                  </button>
                </div>
              </div>
            )}

            {(analisando || excluindo || excluidos !== null) && (
              <div className="p-4 bg-gray-50 border-t flex justify-end">
                <button
                  onClick={() => setLimpezaOpen(false)}
                  disabled={analisando || excluindo}
                  className="px-5 py-2 bg-lie-green text-white font-bold rounded-lg hover:bg-lie-greenDark disabled:opacity-50"
                >
                  Fechar
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
