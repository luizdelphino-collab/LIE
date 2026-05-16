import { useEffect, useState } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Search, FileDown, Loader2, Files } from 'lucide-react';
import { ref, getBlob } from 'firebase/storage';
import JSZip from 'jszip';
import { db, storage } from '../lib/firebase';
import { consolidarEntidade } from '../lib/consolidar';
import type { Entidade, Projeto } from '../types';

interface EntidadeWithCount extends Entidade {
  projectCount: number;
}

export default function EntidadesPage() {
  const [entidades, setEntidades] = useState<EntidadeWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [consolidando, setConsolidando] = useState<string | null>(null);
  const [baixandoDocs, setBaixandoDocs] = useState<{ id: string; current: number; total: number } | null>(null);
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
          const projectCount = projetos.filter(p => p.proponente?.cnpj === ent.cnpj).length;
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

  const handleConsolidar = async (e: React.MouseEvent, entId: string) => {
    e.stopPropagation(); // Não navega para a entidade
    if (consolidando) return;
    setConsolidando(entId);
    try {
      await consolidarEntidade(entId);
    } catch (err: any) {
      console.error(err);
      alert(`Erro ao gerar o dossiê: ${err?.message || err}`);
    } finally {
      setConsolidando(null);
    }
  };

  const handleDownloadDocs = async (e: React.MouseEvent, entId: string) => {
    e.stopPropagation();
    if (baixandoDocs) return;
    
    try {
      const ent = entidades.find(item => item.id === entId);
      if (!ent) return;

      setBaixandoDocs({ id: entId, current: 0, total: 0 });

      const zip = new JSZip();
      const rootFolder = zip.folder(`${ent.sigla || 'Entidade'}_Documentos`);
      if (!rootFolder) return;
      
      const entidadeFolder = rootFolder.folder('1. Entidade');
      const dirigentesFolder = rootFolder.folder('2. Dirigentes');

      // 1. Coletar todas as tarefas de download
      const downloadTasks: { folder: JSZip; url: string; fileName: string }[] = [];

      // Documentos da entidade
      const entDocsSnap = await getDocs(collection(db, `entities/${entId}/documentos`));
      const entDocs = entDocsSnap.docs
        .map(d => d.data())
        .sort((a, b) => (a.ordem || 0) - (b.ordem || 0));

      for (let i = 0; i < entDocs.length; i++) {
        const d = entDocs[i];
        if (d.arquivoUrl && entidadeFolder) {
          const ext = d.arquivoUrl.toLowerCase().includes('.pdf') ? '.pdf' : '';
          downloadTasks.push({
            folder: entidadeFolder,
            url: d.arquivoUrl,
            fileName: `${i + 1}. ${d.nome || 'Documento'}${ext}`
          });
        }
      }

      // Dirigentes
      const dirsSnap = await getDocs(collection(db, `entities/${entId}/dirigentes`));
      const dirigentes = dirsSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a: any, b: any) => (a.ordem || 0) - (b.ordem || 0));

      for (const dir of dirigentes) {
        if (dirigentesFolder) {
          const dirFolder = dirigentesFolder.folder(dir.nome || 'Sem Nome');
          if (dirFolder) {
            const dirDocsSnap = await getDocs(collection(db, `entities/${entId}/dirigentes/${dir.id}/documentos`));
            const dirDocs = dirDocsSnap.docs
              .map(d => d.data())
              .sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
            
            for (let j = 0; j < dirDocs.length; j++) {
              const dd = dirDocs[j];
              if (dd.arquivoUrl) {
                const ext = dd.arquivoUrl.toLowerCase().includes('.pdf') ? '.pdf' : '';
                downloadTasks.push({
                  folder: dirFolder,
                  url: dd.arquivoUrl,
                  fileName: `${j + 1}. ${dd.nome || 'Documento'}${ext}`
                });
              }
            }
          }
        }
      }

      setBaixandoDocs(prev => prev ? { ...prev, total: downloadTasks.length } : null);

      if (downloadTasks.length === 0) {
        alert('Nenhum documento encontrado para baixar.');
        setBaixandoDocs(null);
        return;
      }

      // 2. Executar downloads em paralelo com limite de concorrência (5 por vez)
      const CONCURRENCY = 5;
      const failedFiles: string[] = [];
      let completedCount = 0;

      const runTask = async (task: typeof downloadTasks[0]) => {
        try {
          const match = task.url.match(/\/o\/([^?]+)/);
          const path = match ? decodeURIComponent(match[1]) : null;
          if (path) {
            // Timeout de 30s por arquivo
            const blobPromise = getBlob(ref(storage, path));
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 30000));
            const blob = await Promise.race([blobPromise, timeoutPromise]) as Blob;
            task.folder.file(task.fileName, blob);
          }
        } catch (err) {
          console.error(`Erro ao baixar ${task.fileName}:`, err);
          failedFiles.push(task.fileName);
        } finally {
          completedCount++;
          setBaixandoDocs(prev => prev ? { ...prev, current: completedCount } : null);
        }
      };

      // Processar em lotes
      for (let i = 0; i < downloadTasks.length; i += CONCURRENCY) {
        const batch = downloadTasks.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map(task => runTask(task)));
      }

      // 3. Gerar ZIP
      if (downloadTasks.length > failedFiles.length) {
        const content = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(content);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${ent.sigla || 'Entidade'}_Documentos.zip`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }

      if (failedFiles.length > 0) {
        alert(`Atenção: ${failedFiles.length} arquivos não puderam ser baixados e foram pulados.`);
      }

    } catch (err) {
      console.error(err);
      alert('Erro ao gerar o pacote de documentos.');
    } finally {
      setBaixandoDocs(null);
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
                        onClick={(ev) => handleConsolidar(ev, e.id)}
                        disabled={!!consolidando || !!baixandoDocs}
                        title="Gerar Dossiê PDF (Consolidar)"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-lie-green text-lie-green hover:bg-lie-green hover:text-white rounded-lg text-xs font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {consolidando === e.id ? (
                          <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Gerando...</>
                        ) : (
                          <><FileDown className="w-3.5 h-3.5" /> Consolidar</>
                        )}
                      </button>

                      <button
                        onClick={(ev) => handleDownloadDocs(ev, e.id)}
                        disabled={!!consolidando || !!baixandoDocs}
                        title="Baixar todos os anexos PDF"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-blue-600 text-blue-600 hover:bg-blue-600 hover:text-white rounded-lg text-xs font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {baixandoDocs?.id === e.id ? (
                          <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {baixandoDocs.total > 0 ? `${baixandoDocs.current}/${baixandoDocs.total}` : 'Lendo...'}</>
                        ) : (
                          <><Files className="w-3.5 h-3.5" /> Documentos</>
                        )}
                      </button>
                    </div>
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
