import { useEffect, useState } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Search, FileDown, Loader2, Trash2, Award } from 'lucide-react';
import { db } from '../lib/firebase';
import { deleteDoc, doc } from 'firebase/firestore';
import { consolidarEntidade } from '../lib/consolidar';
import RubricaModal from '../components/RubricaModal';
import type { Entidade, Projeto } from '../types';

interface EntidadeWithCount extends Entidade {
  projectCount: number;
}

export default function EntidadesPage() {
  const [entidades, setEntidades] = useState<EntidadeWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [consolidando, setConsolidando] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const q = query(collection(db, 'entities'), orderBy('criadoEm', 'desc'));
        const snap = await getDocs(q);
        const projSnap = await getDocs(collection(db, 'projects'));
        const projetos = projSnap.docs.map(d => d.data() as Projeto);
        const data = snap.docs.map(d => {
          const ent = { id: d.id, ...d.data() } as Entidade;
          const projectCount = projetos.filter(p => p.entidadeId === ent.id).length;
          return { ...ent, projectCount };
        });
        setEntidades(data);
      } catch (error) {
        console.error('Erro ao carregar entidades', error);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filteredEntidades = entidades.filter(e => {
    const term = searchTerm.toLowerCase();
    return (
      e.nome.toLowerCase().includes(term) ||
      (e.sigla && e.sigla.toLowerCase().includes(term)) ||
      e.cnpj.includes(term)
    );
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [selectedEntId, setSelectedEntId] = useState<string | null>(null);

  const handleConsolidar = async (e: React.MouseEvent, entId: string) => {
    e.stopPropagation();
    setSelectedEntId(entId);
    setModalOpen(true);
  };

  const confirmConsolidar = async (rubricaUrl?: string) => {
    if (!selectedEntId) return;
    setModalOpen(false);
    setConsolidando(selectedEntId);
    try {
      await consolidarEntidade(selectedEntId, rubricaUrl);
    } catch (err: any) {
      console.error(err);
      alert(`Erro ao gerar o dossiê: ${err?.message || err}`);
    } finally {
      setConsolidando(null);
      setSelectedEntId(null);
    }
  };

  const handleExcluir = async (e: React.MouseEvent, entId: string, nome: string) => {
    e.stopPropagation();
    if (!confirm(`Tem certeza que deseja excluir a entidade "${nome}"? Esta ação não pode ser desfeita.`)) return;
    
    try {
      await deleteDoc(doc(db, 'entities', entId));
      setEntidades(prev => prev.filter(ent => ent.id !== entId));
    } catch (err) {
      console.error(err);
      alert('Erro ao excluir entidade.');
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-lie-ink">Entidades</h1>
          <p className="text-sm text-lie-gray">Entidades cadastradas no sistema</p>
        </div>
        <Link
          to="/entidades/nova"
          className="group flex items-center bg-lie-green text-white rounded-lg p-2 transition-all duration-300 overflow-hidden hover:bg-lie-greenDark shadow-sm"
        >
          <Plus className="w-5 h-5 shrink-0" />
          <span className="max-w-0 opacity-0 group-hover:max-w-xs group-hover:opacity-100 group-hover:ml-2 whitespace-nowrap transition-all duration-300 ease-in-out font-medium">
            Nova Entidade
          </span>
        </Link>
      </header>

      <div className="mb-6 relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
        <input 
          type="text" 
          placeholder="Buscar por nome, sigla ou CNPJ..." 
          className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-xl shadow-sm focus:ring-lie-green focus:border-lie-green"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="text-lie-gray">Carregando…</div>
      ) : filteredEntidades.length === 0 ? (
        <div className="bg-white rounded-xl shadow-premium p-12 text-center">
          <p className="text-lie-gray mb-4">Nenhuma entidade encontrada.</p>
          {searchTerm === '' && (
            <Link
              to="/entidades/nova"
              className="inline-flex items-center gap-2 bg-lie-green hover:bg-lie-greenDark text-white font-medium px-4 py-2 rounded-lg"
            >
              <Plus className="w-4 h-4" />
              Cadastrar a primeira entidade
            </Link>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-premium overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 text-left text-xs uppercase text-lie-gray border-b border-gray-200">
              <tr>
                <th className="px-4 py-3">Entidade</th>
                <th className="px-4 py-3">Sigla</th>
                <th className="px-4 py-3">CNPJ</th>
                <th className="px-4 py-3">UF / Cidade</th>
                <th className="px-4 py-3 text-center">Projetos</th>
                <th className="px-4 py-3 text-center">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredEntidades.map((e) => (
                <tr
                  key={e.id}
                  className="hover:bg-gray-50 cursor-pointer transition-colors"
                  onClick={() => navigate(`/entidades/${e.id}`)}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {e.logoUrl && (
                        <img
                          src={e.logoUrl}
                          alt={e.nome}
                          className="w-8 h-8 rounded object-contain bg-white border border-gray-100 shadow-sm flex-shrink-0"
                        />
                      )}
                      <span className="font-medium text-lie-ink">{e.nome}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm">{e.sigla || '-'}</td>
                  <td className="px-4 py-3 text-sm font-mono">{e.cnpj}</td>
                  <td className="px-4 py-3 text-sm">
                    {e.uf && e.cidade ? `${e.uf} - ${e.cidade}` : '-'}
                  </td>
                  <td className="px-4 py-3 text-sm text-center font-semibold">
                    {e.projectCount}
                  </td>
                  <td className="px-4 py-3 text-center" onClick={(ev) => ev.stopPropagation()}>
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={() => navigate(`/entidades/${e.id}/capacidade-tecnica`)}
                        title="Capacidade Técnica e Operacional"
                        className="p-1.5 text-amber-600 hover:bg-amber-50 rounded-lg transition"
                      >
                        <Award className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(ev) => handleConsolidar(ev, e.id)}
                        disabled={!!consolidando}
                        title="Gerar Dossiê PDF (Consolidar)"
                        className="p-1.5 text-lie-green hover:text-lie-greenDark rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {consolidando === e.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <FileDown className="w-4 h-4" />
                        )}
                      </button>
                      <button
                        onClick={(ev) => handleExcluir(ev, e.id, e.nome)}
                        title="Excluir Entidade"
                        className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <RubricaModal 
        isOpen={modalOpen} 
        onClose={() => setModalOpen(false)} 
        onConfirm={confirmConsolidar}
        title="Dossiê da Entidade"
      />
    </div>
  );
}
