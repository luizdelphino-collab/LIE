import { useEffect, useState } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { db } from '../lib/firebase';
import type { Projeto } from '../types';

export default function ProjetosPage() {
  const [projetos, setProjetos] = useState<Projeto[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const q = query(collection(db, 'projects'), orderBy('criadoEm', 'desc'));
        const snap = await getDocs(q);
        setProjetos(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Projeto, 'id'>) })));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const fmt = (v: number) =>
    v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-lie-ink">Projetos</h1>
          <p className="text-sm text-lie-gray">Projetos LIE cadastrados</p>
        </div>
        <Link
          to="/projetos/novo"
          className="inline-flex items-center gap-2 bg-lie-green hover:bg-lie-greenDark text-white font-medium px-4 py-2 rounded-lg transition"
        >
          <Plus className="w-4 h-4" />
          Novo projeto
        </Link>
      </header>

      {loading ? (
        <div className="text-lie-gray">Carregando…</div>
      ) : projetos.length === 0 ? (
        <div className="bg-white rounded-xl shadow-premium p-12 text-center">
          <p className="text-lie-gray mb-4">Nenhum projeto cadastrado ainda.</p>
          <Link
            to="/projetos/novo"
            className="inline-flex items-center gap-2 bg-lie-green hover:bg-lie-greenDark text-white font-medium px-4 py-2 rounded-lg"
          >
            <Plus className="w-4 h-4" />
            Criar o primeiro
          </Link>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-premium overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 text-left text-xs uppercase text-lie-gray">
              <tr>
                <th className="px-4 py-3">Projeto</th>
                <th className="px-4 py-3">Esfera</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Aprovado</th>
                <th className="px-4 py-3">Captado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {projetos.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link to={`/projetos/${p.id}`} className="font-medium text-lie-ink hover:text-lie-green">
                      {p.nome}
                    </Link>
                    <div className="text-xs text-lie-gray">Exerc. {p.exercicio}</div>
                  </td>
                  <td className="px-4 py-3 text-sm capitalize">{p.esfera}</td>
                  <td className="px-4 py-3 text-sm">{p.status.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-3 text-sm font-semibold">{fmt(p.valorAprovado)}</td>
                  <td className="px-4 py-3 text-sm">{fmt(p.valorCaptado)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
