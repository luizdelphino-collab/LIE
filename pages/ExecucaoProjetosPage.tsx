import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, orderBy, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Search, Briefcase, Calendar, ChevronRight } from 'lucide-react';
import type { Projeto, Entidade } from '../types';

export default function ExecucaoProjetosPage() {
  const [projetos, setProjetos] = useState<Projeto[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    const fetchProjetos = async () => {
      try {
        const q = query(collection(db, 'projects'), orderBy('criadoEm', 'desc'));
        const snap = await getDocs(q);
        
        // Carregar entidades para pegar a sigla
        const entSnap = await getDocs(collection(db, 'entities'));
        const entidadesMap: Record<string, string> = {};
        entSnap.forEach(d => {
          const data = d.data() as Entidade;
          entidadesMap[d.id] = data.sigla || data.nome;
        });

        const list = snap.docs.map(d => {
          const data = d.data() as Projeto;
          return {
            ...data,
            id: d.id,
            entidadeSigla: entidadesMap[data.entidadeId]
          } as Projeto;
        });
        setProjetos(list);
      } catch (err) {
        console.error("Erro ao buscar projetos", err);
      } finally {
        setLoading(false);
      }
    };
    fetchProjetos();
  }, []);

  const filtered = projetos.filter(p => {
    const term = search.toLowerCase();
    const title = (p.titulo || p.nome || 'Projeto Sem Título').toLowerCase();
    return title.includes(term) || p.id.toLowerCase().includes(term);
  });

  return (
    <div className="p-6 max-w-7xl mx-auto pb-32">
      <header className="mb-8">
        <h1 className="text-3xl font-black text-lie-ink tracking-tight mb-2 flex items-center gap-2">
          <Briefcase className="w-8 h-8 text-lie-green" />
          Execução de Projetos
        </h1>
        <p className="text-lie-gray">Selecione um projeto para indicar fornecedores e registrar as execuções mensais.</p>
      </header>

      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center gap-3 mb-6">
        <Search className="w-5 h-5 text-gray-400" />
        <input 
          type="text" 
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar projeto por título..."
          className="flex-1 bg-transparent border-none outline-none text-lie-ink placeholder-gray-400 font-medium"
        />
      </div>

      {loading ? (
        <div className="text-center p-12 text-lie-gray">Carregando projetos...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center p-12 text-lie-gray bg-white rounded-xl shadow-sm border border-gray-100">
          Nenhum projeto encontrado.
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-premium overflow-hidden border border-gray-100">
          <table className="w-full text-left">
            <thead className="bg-gray-50 text-xs font-bold text-lie-gray uppercase border-b border-gray-200">
              <tr>
                <th className="px-4 py-3">Entidade</th>
                <th className="px-4 py-3">Projeto</th>
                <th className="px-4 py-3 text-center">Duração</th>
                <th className="px-4 py-3 text-right">Valor Aprovado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(p => (
                <tr 
                  key={p.id}
                  onClick={() => navigate(`/execucao/${p.id}/fornecedores`)}
                  className="hover:bg-gray-50 cursor-pointer transition-colors group"
                >
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {p.entidadeSigla || 'Não informada'}
                  </td>
                  <td className="px-4 py-3 font-medium text-lie-ink">
                    <div className="flex items-center justify-between">
                      <span className="line-clamp-2">{p.titulo || 'Projeto sem título'}</span>
                      <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-lie-green opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-center text-gray-600">
                    {p.duracaoMeses || 12} meses
                  </td>
                  <td className="px-4 py-3 text-sm text-right font-medium text-lie-ink">
                    {p.valorAprovado ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(p.valorAprovado) : 'R$ 0,00'}
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
