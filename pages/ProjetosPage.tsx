import { useEffect, useState } from 'react';
import { collection, getDocs, orderBy, query, deleteDoc, doc, setDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Search, FileDown, Loader2, Trash2, Calendar, Building2, FileText, Package, Copy } from 'lucide-react';
import { db } from '../lib/firebase';
import { consolidarProjeto } from '../lib/consolidarProjeto';
import RubricaModal from '../components/RubricaModal';
import type { Projeto, Entidade, StatusProjeto } from '../types';

export default function ProjetosPage() {
  const [projetos, setProjetos] = useState<(Projeto & { entidadeSigla?: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [consolidando, setConsolidando] = useState<string | null>(null);
  const navigate = useNavigate();

  const loadProjetos = async () => {
    try {
      setLoading(true);
      const q = query(collection(db, 'projects'), orderBy('criadoEm', 'desc'));
      const snap = await getDocs(q);
      
      // Carregar entidades para pegar a sigla
      const entSnap = await getDocs(collection(db, 'entities'));
      const entidadesMap: Record<string, string> = {};
      entSnap.forEach(d => {
        const data = d.data() as Entidade;
        entidadesMap[d.id] = data.sigla || data.nome;
      });

      const data = snap.docs.map(d => ({
        id: d.id,
        ...d.data(),
        entidadeSigla: entidadesMap[(d.data() as any).entidadeId]
      } as any));
      
      setProjetos(data);
    } catch (error) {
      console.error('Erro ao carregar projetos', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProjetos();
  }, []);

  const handleDuplicar = async (e: React.MouseEvent, projetoOriginal: Projeto) => {
    e.stopPropagation();
    if (!confirm(`Deseja duplicar o projeto "${projetoOriginal.titulo || projetoOriginal.nome}"?`)) return;
    
    setLoading(true);
    try {
      const newProjectId = doc(collection(db, 'projects')).id;
      
      // 1. Duplicar documento principal
      const originalTitle = projetoOriginal.titulo || projetoOriginal.nome || 'Projeto';
      const payload: Partial<Projeto> = {
        ...projetoOriginal,
        id: newProjectId,
        titulo: `[Cópia] ${originalTitle}`,
        nome: `[Cópia] ${originalTitle}`,
        status: 'em_elaboracao',
        valorExecutado: 0,
        valorCaptado: 0,
        criadoEm: serverTimestamp() as any,
        atualizadoEm: serverTimestamp() as any
      };
      
      await setDoc(doc(db, 'projects', newProjectId), payload);
      
      // 2. Duplicar itens do projeto (projects/${id}/items)
      const itemsSnap = await getDocs(collection(db, `projects/${projetoOriginal.id}/items`));
      const batch = writeBatch(db);
      
      itemsSnap.forEach(itemDoc => {
        const itemData = itemDoc.data();
        const newItemId = doc(collection(db, `projects/${newProjectId}/items`)).id;
        
        batch.set(doc(db, `projects/${newProjectId}/items`, newItemId), {
          ...itemData,
          id: newItemId,
          projectId: newProjectId,
          fornecedoresIds: [], // Zerar fornecedores vinculados na execução
          criadoEm: serverTimestamp()
        });
      });
      
      // 3. Duplicar documentos do projeto (projects/${id}/documentos)
      const docsSnap = await getDocs(collection(db, `projects/${projetoOriginal.id}/documentos`));
      
      docsSnap.forEach(docDoc => {
        const docData = docDoc.data();
        const newDocId = doc(collection(db, `projects/${newProjectId}/documentos`)).id;
        
        batch.set(doc(db, `projects/${newProjectId}/documentos`, newDocId), {
          ...docData,
          id: newDocId,
          projectId: newProjectId,
          criadoEm: serverTimestamp()
        });
      });
      
      await batch.commit();
      alert('Projeto duplicado com sucesso!');
      await loadProjetos();
      
    } catch (err) {
      console.error(err);
      alert('Erro ao duplicar projeto: ' + (err instanceof Error ? err.message : 'Erro desconhecido'));
    } finally {
      setLoading(false);
    }
  };

  const handleExcluir = async (e: React.MouseEvent, id: string, titulo: string) => {
    e.stopPropagation();
    if (!confirm(`Tem certeza que deseja excluir o projeto "${titulo}"?`)) return;
    try {
      await deleteDoc(doc(db, 'projects', id));
      setProjetos(prev => prev.filter(p => p.id !== id));
    } catch (err) {
      console.error(err);
      alert('Erro ao excluir projeto.');
    }
  };

  const handleStatusChange = async (projeto: Projeto, novoStatus: StatusProjeto) => {
    const statusOriginal = projeto.status || 'em_elaboracao';
    if (statusOriginal === novoStatus) return;

    const labelOriginal = formatStatus(statusOriginal);
    const labelNovo = formatStatus(novoStatus);

    const confirmar = window.confirm(
      `Deseja alterar o status do projeto "${projeto.titulo || projeto.nome}" de "${labelOriginal}" para "${labelNovo}"?`
    );

    if (!confirmar) return;

    try {
      setLoading(true);
      const projRef = doc(db, 'projects', projeto.id);
      await setDoc(projRef, { 
        status: novoStatus, 
        atualizadoEm: serverTimestamp() 
      }, { merge: true });

      alert(`Status do projeto "${projeto.titulo || projeto.nome}" alterado para "${labelNovo}" com sucesso!`);
      await loadProjetos();
    } catch (err) {
      console.error(err);
      alert('Erro ao alterar status do projeto: ' + (err instanceof Error ? err.message : 'Erro desconhecido'));
      await loadProjetos(); // Recarrega se der erro para restabelecer o select
    } finally {
      setLoading(false);
    }
  };

  const [modalOpen, setModalOpen] = useState(false);
  const [selectedProjId, setSelectedProjId] = useState<string | null>(null);

  const handleConsolidar = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setSelectedProjId(id);
    setModalOpen(true);
  };

  const confirmConsolidar = async (rubricaUrl?: string) => {
    if (!selectedProjId) return;
    setModalOpen(false);
    setConsolidando(selectedProjId);
    try {
      await consolidarProjeto(selectedProjId, rubricaUrl);
    } catch (err) {
      console.error(err);
      alert('Erro ao gerar PDF do projeto.');
    } finally {
      setConsolidando(null);
      setSelectedProjId(null);
    }
  };

  const filteredProjetos = projetos.filter(p => {
    const term = searchTerm.toLowerCase();
    const title = (p.titulo || p.nome || 'Projeto Sem Título').toLowerCase();
    return (
      title.includes(term) ||
      (p.entidadeSigla && p.entidadeSigla.toLowerCase().includes(term))
    );
  });

  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'aprovado': return 'bg-green-100 text-green-800';
      case 'em_elaboracao': return 'bg-blue-100 text-blue-800';
      case 'em_captacao': return 'bg-purple-100 text-purple-800';
      case 'em_execucao': return 'bg-emerald-100 text-emerald-800';
      case 'cancelado': return 'bg-red-100 text-red-800';
      case 'reprovado': return 'bg-red-100 text-red-800';
      case 'diligencias': return 'bg-amber-100 text-amber-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const formatStatus = (status?: string) => {
    if (!status) return 'Em Elaboração';
    if (status === 'em_elaboracao') return 'Em Elaboração';
    if (status === 'em_captacao') return 'Em Captação';
    if (status === 'em_execucao') return 'Em Execução';
    if (status === 'diligencias') return 'Diligências';
    return status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  const calculateDuration = (p: Projeto) => {
    if (!p.mesInicio || !p.mesTermino) return '-';
    const start = new Date(p.mesInicio + '-01');
    const end = new Date(p.mesTermino + '-01');
    const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) + 1;
    return `${months} meses`;
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-lie-ink">Projetos</h1>
          <p className="text-sm text-lie-gray">Gestão de planos de trabalho e execução</p>
        </div>
        <Link
          to="/projetos/novo"
          className="group flex items-center bg-lie-green text-white rounded-lg p-2 transition-all duration-300 overflow-hidden hover:bg-lie-greenDark shadow-sm"
        >
          <Plus className="w-5 h-5 shrink-0" />
          <span className="max-w-0 opacity-0 group-hover:max-w-xs group-hover:opacity-100 group-hover:ml-2 whitespace-nowrap transition-all duration-300 ease-in-out font-medium">
            Novo Projeto
          </span>
        </Link>
      </header>

      <div className="mb-6 relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
        <input
          type="text"
          className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-xl shadow-sm focus:ring-lie-green focus:border-lie-green sm:text-sm"
          placeholder="Buscar por título ou entidade..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="text-lie-gray">Carregando…</div>
      ) : filteredProjetos.length === 0 ? (
        <div className="bg-white rounded-xl shadow-premium p-12 text-center border border-gray-100">
          <p className="text-lie-gray mb-4">Nenhum projeto encontrado.</p>
          {searchTerm === '' && (
            <Link to="/projetos/novo" className="inline-flex items-center gap-2 bg-lie-green hover:bg-lie-greenDark text-white font-medium px-4 py-2 rounded-lg">
              <Plus className="w-4 h-4" /> Cadastrar o primeiro projeto
            </Link>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-premium overflow-hidden border border-gray-100">
          <table className="w-full">
            <thead className="bg-gray-50 text-left text-xs uppercase text-lie-gray border-b border-gray-200">
              <tr>
                <th className="px-4 py-3">Título</th>
                <th className="px-4 py-3">Entidade</th>
                <th className="px-4 py-3 text-center">Duração</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-center">Última Atualização</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredProjetos.map((p) => (
                <tr
                  key={p.id}
                  className="hover:bg-gray-50 cursor-pointer transition-colors"
                  onClick={() => navigate(`/projetos/${p.id}`)}
                >
                  <td className="px-4 py-3 font-medium text-lie-ink">{p.titulo || p.nome || 'Projeto Sem Título'}</td>
                  <td className="px-4 py-3 text-sm">
                    <div className="flex items-center gap-1.5 text-gray-600">
                      <Building2 className="w-3.5 h-3.5" />
                      {p.entidadeSigla || 'Não informada'}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-center">
                    <div className="flex items-center justify-center gap-1.5 text-gray-600">
                      <Calendar className="w-3.5 h-3.5" />
                      {calculateDuration(p)}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center" onClick={(ev) => ev.stopPropagation()}>
                    <select
                      value={p.status || 'em_elaboracao'}
                      onChange={(ev) => handleStatusChange(p, ev.target.value as StatusProjeto)}
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold cursor-pointer border border-transparent hover:border-gray-300 focus:ring-1 focus:ring-offset-1 focus:ring-lie-green transition-all outline-none ${getStatusColor(p.status)}`}
                      title="Clique para alterar o status"
                    >
                      <option value="em_elaboracao">Em Elaboração</option>
                      <option value="em_captacao">Em Captação</option>
                      <option value="aprovado">Aprovado</option>
                      <option value="em_execucao">Em Execução</option>
                      <option value="reprovado">Reprovado</option>
                      <option value="diligencias">Diligências</option>
                      {p.status && !['em_elaboracao', 'em_captacao', 'aprovado', 'em_execucao', 'reprovado', 'diligencias'].includes(p.status) && (
                        <option value={p.status}>{formatStatus(p.status)}</option>
                      )}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-sm text-center text-gray-500">
                    {p.atualizadoEm?.toDate().toLocaleDateString('pt-BR') || '-'}
                  </td>
                  <td className="px-4 py-3 text-right" onClick={(ev) => ev.stopPropagation()}>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={(ev) => { ev.stopPropagation(); navigate(`/projetos/${p.id}/itens`); }}
                        className="p-1.5 text-amber-600 hover:bg-amber-50 rounded transition"
                        title="Itens do Projeto"
                      >
                        <Package className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(ev) => { ev.stopPropagation(); navigate(`/projetos/${p.id}/cronograma`); }}
                        className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded transition"
                        title="Cronograma Financeiro"
                      >
                        <Calendar className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(ev) => { ev.stopPropagation(); navigate(`/projetos/${p.id}/documentos`); }}
                        className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition"
                        title="Documentos do Projeto"
                      >
                        <FileText className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(ev) => handleConsolidar(ev, p.id)}
                        disabled={!!consolidando}
                        className="p-1.5 text-lie-green hover:bg-green-50 rounded transition"
                        title="Consolidar PDF"
                      >
                        {consolidando === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
                      </button>
                      <button
                        onClick={(ev) => handleDuplicar(ev, p)}
                        className="p-1.5 text-blue-500 hover:bg-blue-50 rounded transition"
                        title="Duplicar Projeto"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(ev) => handleExcluir(ev, p.id, p.titulo)}
                        className="p-1.5 text-red-500 hover:bg-red-50 rounded transition"
                        title="Excluir Projeto"
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
        title="Plano de Trabalho do Projeto"
      />
    </div>
  );
}
