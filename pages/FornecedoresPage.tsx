import { useEffect, useState } from 'react';
import { collection, getDocs, query, orderBy, deleteDoc, doc } from 'firebase/firestore';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Search, Trash2, Building2, MapPin, Tag } from 'lucide-react';
import { db } from '../lib/firebase';
import type { Fornecedor } from '../types';

export default function FornecedoresPage() {
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const navigate = useNavigate();

  const carregarFornecedores = async () => {
    try {
      setLoading(true);
      const q = query(collection(db, 'suppliers'), orderBy('razaoSocial', 'asc'));
      const snap = await getDocs(q);
      setFornecedores(snap.docs.map(d => ({ id: d.id, ...d.data() } as Fornecedor)));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregarFornecedores();
  }, []);

  const handleDelete = async (ev: React.MouseEvent, id: string) => {
    ev.stopPropagation();
    if (!confirm("Tem certeza que deseja excluir este fornecedor?")) return;
    try {
      await deleteDoc(doc(db, 'suppliers', id));
      setFornecedores(prev => prev.filter(f => f.id !== id));
    } catch (e) {
      console.error(e);
      alert("Erro ao excluir");
    }
  };

  const filtered = fornecedores.filter(f => 
    f.razaoSocial.toLowerCase().includes(searchTerm.toLowerCase()) ||
    f.nomeFantasia.toLowerCase().includes(searchTerm.toLowerCase()) ||
    f.cnpj.includes(searchTerm)
  );

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-lie-ink">Fornecedores</h1>
          <p className="text-sm text-lie-gray">Gestão do banco de fornecedores e prestadores de serviço</p>
        </div>
        <Link
          to="/fornecedores/novo"
          className="inline-flex items-center gap-2 bg-lie-green hover:bg-lie-greenDark text-white font-medium px-4 py-2 rounded-lg shadow-sm transition"
        >
          <Plus className="w-4 h-4" /> Novo Fornecedor
        </Link>
      </header>

      <div className="mb-6 relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <Search className="h-5 w-5 text-gray-400" />
        </div>
        <input
          type="text"
          className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-xl bg-white placeholder-gray-500 focus:outline-none focus:ring-lie-green focus:border-lie-green sm:text-sm"
          placeholder="Buscar por Razão Social, Fantasia ou CNPJ..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="text-lie-gray italic">Carregando fornecedores...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl shadow-premium p-12 text-center border border-gray-100">
          <Building2 className="w-12 h-12 text-gray-200 mx-auto mb-4" />
          <p className="text-lie-gray">Nenhum fornecedor encontrado.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-premium overflow-hidden border border-gray-100">
          <table className="w-full text-left">
            <thead className="bg-gray-50 text-xs font-bold text-lie-gray uppercase border-b border-gray-200">
              <tr>
                <th className="px-4 py-3">Fornecedor</th>
                <th className="px-4 py-3">CNPJ</th>
                <th className="px-4 py-3">Localização</th>
                <th className="px-4 py-3">Atividade Primária</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(f => (
                <tr 
                  key={f.id} 
                  className="hover:bg-gray-50 cursor-pointer transition-colors"
                  onClick={() => navigate(`/fornecedores/${f.id}`)}
                >
                  <td className="px-4 py-3">
                    <div className="font-bold text-lie-ink">{f.razaoSocial}</div>
                    <div className="text-xs text-lie-gray italic">{f.nomeFantasia}</div>
                  </td>
                  <td className="px-4 py-3 text-sm font-mono text-gray-600">{f.cnpj}</td>
                  <td className="px-4 py-3 text-sm">
                    <div className="flex items-center gap-1 text-gray-600">
                      <MapPin className="w-3.5 h-3.5 text-gray-400" />
                      {f.cidade && f.uf ? `${f.cidade} / ${f.uf}` : '-'}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <div className="flex items-center gap-1 text-gray-600">
                      <Tag className="w-3.5 h-3.5 text-gray-400" />
                      {f.atuacaoPrimaria}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button 
                      onClick={(ev) => handleDelete(ev, f.id)}
                      className="p-1.5 text-red-500 hover:bg-red-50 rounded transition"
                      title="Excluir"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
