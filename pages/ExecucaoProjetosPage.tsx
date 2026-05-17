import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, orderBy, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Search, Briefcase, Calendar, ChevronRight } from 'lucide-react';
import type { Projeto } from '../types';

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
        const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Projeto));
        setProjetos(list);
      } catch (err) {
        console.error("Erro ao buscar projetos", err);
      } finally {
        setLoading(false);
      }
    };
    fetchProjetos();
  }, []);

  const filtered = projetos.filter(p => 
    p.titulo?.toLowerCase().includes(search.toLowerCase()) ||
    p.id.toLowerCase().includes(search.toLowerCase())
  );

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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map(p => (
            <div 
              key={p.id}
              onClick={() => navigate(`/execucao/${p.id}/fornecedores`)}
              className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 cursor-pointer hover:shadow-premium hover:-translate-y-1 transition-all group relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-1.5 h-full bg-lie-green transform scale-y-0 group-hover:scale-y-100 transition-transform origin-bottom"></div>
              
              <div className="flex justify-between items-start mb-4">
                <h2 className="font-bold text-lie-ink text-lg line-clamp-2 pr-4">{p.titulo || 'Projeto sem título'}</h2>
                <div className="p-2 bg-gray-50 rounded-full text-gray-400 group-hover:bg-green-50 group-hover:text-lie-green transition-colors flex-shrink-0">
                  <ChevronRight className="w-5 h-5" />
                </div>
              </div>
              
              <div className="space-y-2 text-sm text-gray-500">
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-gray-400" />
                  <span>Duração: <strong className="text-gray-700">{p.duracaoMeses || 12} meses</strong></span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
