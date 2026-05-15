import { useEffect, useState } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { db } from '../lib/firebase';
import type { Entidade, Projeto } from '../types';

interface EntidadeWithCount extends Entidade {
  projectCount: number;
}

export default function EntidadesPage() {
  const [entidades, setEntidades] = useState<EntidadeWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const q = query(collection(db, 'entities'), orderBy('criadoEm', 'desc'));
        const snap = await getDocs(q);
        
        // Also fetch projects to count
        const projSnap = await getDocs(collection(db, 'projects'));
        const projetos = projSnap.docs.map(d => d.data() as Projeto);

        const data = snap.docs.map(d => {
          const ent = { id: d.id, ...d.data() } as Entidade;
          // Contagem de projetos vinculados por CNPJ (já que projeto hoje embute o proponente)
          const projectCount = projetos.filter(p => p.proponente?.cnpj === ent.cnpj).length;
          return { ...ent, projectCount };
        });
        
        setEntidades(data);
      } catch (error) {
        console.error("Erro ao carregar entidades", error);
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

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-lie-ink">Entidades</h1>
          <p className="text-sm text-lie-gray">Entidades cadastradas no sistema</p>
        </div>
        <Link
          to="/entidades/nova"
          className="inline-flex items-center gap-2 bg-lie-green hover:bg-lie-greenDark text-white font-medium px-4 py-2 rounded-lg transition"
        >
          <Plus className="w-4 h-4" />
          Nova Entidade
        </Link>
      </header>

      <div className="mb-6 relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <Search className="h-5 w-5 text-gray-400" />
        </div>
        <input
          type="text"
          className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg leading-5 bg-white placeholder-gray-500 focus:outline-none focus:ring-lie-green focus:border-lie-green sm:text-sm"
          placeholder="Buscar por nome, sigla ou CNPJ..."
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
            <thead className="bg-gray-50 text-left text-xs uppercase text-lie-gray">
              <tr>
                <th className="px-4 py-3">Entidade</th>
                <th className="px-4 py-3">Sigla</th>
                <th className="px-4 py-3">CNPJ</th>
                <th className="px-4 py-3">UF / Cidade</th>
                <th className="px-4 py-3 text-center">Projetos</th>
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
                    <div className="font-medium text-lie-ink">{e.nome}</div>
                  </td>
                  <td className="px-4 py-3 text-sm">{e.sigla || '-'}</td>
                  <td className="px-4 py-3 text-sm">{e.cnpj}</td>
                  <td className="px-4 py-3 text-sm">
                    {e.uf && e.cidade ? `${e.uf} - ${e.cidade}` : '-'}
                  </td>
                  <td className="px-4 py-3 text-sm text-center font-semibold">
                    {e.projectCount}
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
