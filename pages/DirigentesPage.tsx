import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { collection, getDocs, doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { ArrowLeft, Plus, Pencil, Trash2, Eye, ArrowUp, ArrowDown } from 'lucide-react';
import { db } from '../lib/firebase';
import type { Dirigente, Entidade } from '../types';

export default function DirigentesPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [entidade, setEntidade] = useState<Entidade | null>(null);
  const [dirigentes, setDirigentes] = useState<Dirigente[]>([]);
  const [loading, setLoading] = useState(true);

  const carregar = async () => {
    if (!id) return;
    try {
      setLoading(true);
      const entSnap = await getDoc(doc(db, 'entities', id));
      if (entSnap.exists()) setEntidade({ id: entSnap.id, ...entSnap.data() } as Entidade);

      const snap = await getDocs(collection(db, `entities/${id}/dirigentes`));
      const lista = snap.docs.map(d => ({ id: d.id, ...d.data() } as Dirigente));
      lista.sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
      setDirigentes(lista);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { carregar(); }, [id]);

  const excluir = async (dirId: string) => {
    if (!confirm('Excluir este dirigente?')) return;
    await deleteDoc(doc(db, `entities/${id}/dirigentes`, dirId));
    setDirigentes(prev => prev.filter(d => d.id !== dirId));
  };

  const mover = async (index: number, dir: 'up' | 'down') => {
    const lista = [...dirigentes];
    if (dir === 'up' && index === 0) return;
    if (dir === 'down' && index === lista.length - 1) return;
    const swap = dir === 'up' ? index - 1 : index + 1;
    [lista[index], lista[swap]] = [lista[swap], lista[index]];
    lista.forEach((d, i) => { d.ordem = i; });
    setDirigentes(lista);
    for (const d of lista) {
      await setDoc(doc(db, `entities/${id}/dirigentes`, d.id), { ordem: d.ordem }, { merge: true });
    }
  };

  if (loading) return <div className="p-6 text-lie-gray">Carregando…</div>;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate(`/entidades/${id}`)} className="p-2 text-lie-gray hover:bg-gray-100 rounded-lg">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-lie-ink">Dirigentes</h1>
            <p className="text-sm text-lie-gray">{entidade?.nome}</p>
          </div>
        </div>
        <button
          onClick={() => navigate(`/entidades/${id}/dirigentes/novo`)}
          className="group flex items-center bg-lie-green text-white rounded-lg p-2 transition-all duration-300 overflow-hidden hover:bg-lie-greenDark shadow-sm"
        >
          <Plus className="w-5 h-5 shrink-0" />
          <span className="max-w-0 opacity-0 group-hover:max-w-xs group-hover:opacity-100 group-hover:ml-2 whitespace-nowrap transition-all duration-300 ease-in-out font-medium">
            Novo Dirigente
          </span>
        </button>
      </header>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100">
        {dirigentes.length === 0 ? (
          <div className="p-8 text-center text-lie-gray">Nenhum dirigente cadastrado ainda.</div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 text-left text-xs uppercase text-lie-gray border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 w-16 text-center">Ordem</th>
                <th className="px-4 py-3">Nome</th>
                <th className="px-4 py-3">Cargo</th>
                <th className="px-4 py-3">CPF</th>
                <th className="px-4 py-3">Telefone</th>
                <th className="px-4 py-3">E-mail</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {dirigentes.map((d, index) => (
                <tr key={d.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => navigate(`/entidades/${id}/dirigentes/${d.id}`)}>
                  <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                    <div className="flex flex-col items-center gap-0.5 text-gray-400">
                      <button onClick={(e) => { e.stopPropagation(); mover(index, 'up'); }} disabled={index === 0} className="hover:text-lie-ink disabled:opacity-30"><ArrowUp className="w-4 h-4" /></button>
                      <button onClick={(e) => { e.stopPropagation(); mover(index, 'down'); }} disabled={index === dirigentes.length - 1} className="hover:text-lie-ink disabled:opacity-30"><ArrowDown className="w-4 h-4" /></button>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-medium text-lie-ink">{d.nome}</td>
                  <td className="px-4 py-3 text-sm text-lie-gray">{d.cargo || '-'}</td>
                  <td className="px-4 py-3 text-sm">{d.cpf || '-'}</td>
                  <td className="px-4 py-3 text-sm">{d.telefone || '-'}</td>
                  <td className="px-4 py-3 text-sm">{d.email || '-'}</td>
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => navigate(`/entidades/${id}/dirigentes/${d.id}`)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded" title="Visualizar / Editar">
                        <Eye className="w-4 h-4" />
                      </button>
                      <button onClick={() => navigate(`/entidades/${id}/dirigentes/${d.id}`)} className="p-1.5 text-gray-600 hover:bg-gray-100 rounded" title="Editar">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button onClick={() => excluir(d.id)} className="p-1.5 text-red-500 hover:bg-red-50 rounded" title="Excluir">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
