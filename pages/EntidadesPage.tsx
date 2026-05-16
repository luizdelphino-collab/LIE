import { useEffect, useState } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Search, FileDown, Loader2, Files, X, Download, Folder, User } from 'lucide-react';
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
  const [modalDocs, setModalDocs] = useState<{ open: boolean; entId: string; entNome: string; sigla: string; data: any } | null>(null);
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

  const openDocsModal = async (e: React.MouseEvent, ent: Entidade) => {
    e.stopPropagation();
    setModalDocs({ open: true, entId: ent.id, entNome: ent.nome, sigla: ent.sigla || 'Entidade', data: null });
    
    try {
      const entId = ent.id;
      // Carregar estrutura completa
      const entDocsSnap = await getDocs(collection(db, `entities/${entId}/documentos`));
      const entDocs = entDocsSnap.docs.map(d => d.data()).sort((a, b) => (a.ordem || 0) - (b.ordem || 0));

      const dirsSnap = await getDocs(collection(db, `entities/${entId}/dirigentes`));
      const dirigentes = [];
      for (const d of dirsSnap.docs) {
        const dirData = { id: d.id, ...d.data() };
        const dirDocsSnap = await getDocs(collection(db, `entities/${entId}/dirigentes/${d.id}/documentos`));
        (dirData as any).documentos = dirDocsSnap.docs.map(dd => dd.data()).sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
        dirigentes.push(dirData);
      }

      setModalDocs(prev => prev ? { ...prev, data: { entDocs, dirigentes } } : null);
    } catch (err) {
      console.error(err);
      alert('Erro ao carregar lista de documentos.');
    }
  };

  const handleDownloadPartialZip = async (zipName: string, tasks: { url: string; fileName: string }[]) => {
    if (baixandoDocs) return;
    setBaixandoDocs({ id: 'partial', current: 0, total: tasks.length });
    
    try {
      const zip = new JSZip();
      let count = 0;
      const failed = [];

      for (const t of tasks) {
        try {
          const match = t.url.match(/\/o\/([^?]+)/);
          const path = match ? decodeURIComponent(match[1]) : null;
          if (path) {
            const blob = await getBlob(ref(storage, path));
            zip.file(t.fileName, blob);
          } else {
            const resp = await fetch(t.url);
            const blob = await resp.blob();
            zip.file(t.fileName, blob);
          }
        } catch (err) {
          console.error(err);
          failed.push(t.fileName);
        } finally {
          count++;
          setBaixandoDocs(prev => prev ? { ...prev, current: count } : null);
        }
      }

      if (tasks.length > failed.length) {
        const content = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(content);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${zipName}.zip`;
        a.click();
      }
      if (failed.length > 0) alert(`${failed.length} arquivos falharam e foram pulados.`);
    } catch (err) {
      alert('Erro ao gerar ZIP parcial.');
    } finally {
      setBaixandoDocs(null);
    }
  };

  const handleDownloadZipFromModal = async () => {
    if (!modalDocs || !modalDocs.data || baixandoDocs) return;
    const { entId, sigla, data } = modalDocs;
    
    setBaixandoDocs({ id: entId, current: 0, total: 0 });
    
    try {
      const zip = new JSZip();
      const rootFolder = zip.folder(`${sigla}_Documentos`);
      const entidadeFolder = rootFolder?.folder('1. Entidade');
      const dirigentesFolder = rootFolder?.folder('2. Dirigentes');

      const tasks: { folder: JSZip; url: string; fileName: string }[] = [];

      data.entDocs.forEach((d: any, i: number) => {
        if (d.arquivoUrl && entidadeFolder) {
          const ext = d.arquivoUrl.toLowerCase().includes('.pdf') ? '.pdf' : '';
          tasks.push({ folder: entidadeFolder, url: d.arquivoUrl, fileName: `${i + 1}. ${d.nome || 'Doc'}${ext}` });
        }
      });

      data.dirigentes.forEach((dir: any) => {
        const dirFolder = dirigentesFolder?.folder(dir.nome || 'Sem Nome');
        if (dirFolder) {
          dir.documentos.forEach((dd: any, j: number) => {
            if (dd.arquivoUrl) {
              const ext = dd.arquivoUrl.toLowerCase().includes('.pdf') ? '.pdf' : '';
              tasks.push({ folder: dirFolder, url: dd.arquivoUrl, fileName: `${j + 1}. ${dd.nome || 'Doc'}${ext}` });
            }
          });
        }
      });

      setBaixandoDocs(prev => prev ? { ...prev, total: tasks.length } : null);
      let count = 0;
      const failed = [];

      for (const t of tasks) {
        try {
          const match = t.url.match(/\/o\/([^?]+)/);
          const path = match ? decodeURIComponent(match[1]) : null;
          if (path) {
            const blob = await getBlob(ref(storage, path));
            t.folder.file(t.fileName, blob);
          } else {
            // Tentar download direto se não for link do storage
            const resp = await fetch(t.url);
            const blob = await resp.blob();
            t.folder.file(t.fileName, blob);
          }
        } catch (err) {
          console.error(err);
          failed.push(t.fileName);
        } finally {
          count++;
          setBaixandoDocs(prev => prev ? { ...prev, current: count } : null);
        }
      }

      if (tasks.length > failed.length) {
        const content = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(content);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${sigla}_Documentos.zip`;
        a.click();
      }

      if (failed.length > 0) alert(`${failed.length} arquivos falharam no ZIP e foram pulados.`);
    } catch (err) {
      alert('Erro ao gerar ZIP.');
    } finally {
      setBaixandoDocs(null);
    }
  };

  const handleDownloadDocs = async (e: React.MouseEvent, entId: string) => {
    // Agora delegamos para o modal, mas mantemos o nome da função para não quebrar a tipagem se necessário
    // Mas vamos mudar o onClick no JSX para openDocsModal
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
                        onClick={(ev) => openDocsModal(ev, e)}
                        disabled={!!consolidando || !!baixandoDocs}
                        title="Ver documentos e baixar anexos"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-blue-600 text-blue-600 hover:bg-blue-600 hover:text-white rounded-lg text-xs font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Files className="w-3.5 h-3.5" /> Documentos
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {/* Modal de Documentos */}
      {modalDocs?.open && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
            <header className="p-4 border-b flex items-center justify-between bg-gray-50">
              <div>
                <h2 className="text-xl font-bold text-lie-ink">{modalDocs.sigla} - Documentos</h2>
                <p className="text-sm text-lie-gray line-clamp-1">{modalDocs.entNome}</p>
              </div>
              <button onClick={() => setModalDocs(null)} className="p-2 hover:bg-gray-200 rounded-full transition">
                <X className="w-6 h-6 text-gray-500" />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto p-6 space-y-8">
              {!modalDocs.data ? (
                <div className="flex flex-col items-center justify-center py-12 gap-4">
                  <Loader2 className="w-10 h-10 text-lie-green animate-spin" />
                  <p className="text-lie-gray font-medium">Carregando estrutura de pastas...</p>
                </div>
              ) : (
                <>
                  {/* Seção Entidade */}
                  <section>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2 text-lie-green font-bold text-sm uppercase tracking-wider">
                        <Folder className="w-4 h-4" /> 1. Entidade
                      </div>
                      {modalDocs.data.entDocs.length > 0 && (
                        <button 
                          onClick={() => handleDownloadPartialZip(`${modalDocs.sigla}_Documentos_Entidade`, modalDocs.data.entDocs.map((d: any, i: number) => ({
                            url: d.arquivoUrl,
                            fileName: `${i + 1}. ${d.nome || 'Doc'}${d.arquivoUrl.toLowerCase().includes('.pdf') ? '.pdf' : ''}`
                          })))}
                          disabled={!!baixandoDocs}
                          className="text-[10px] bg-lie-green/10 text-lie-green px-2 py-1 rounded-md hover:bg-lie-green hover:text-white transition font-bold flex items-center gap-1"
                        >
                          <FileDown className="w-3 h-3" /> ZIP DA ENTIDADE
                        </button>
                      )}
                    </div>
                    <div className="space-y-2">
                      {modalDocs.data.entDocs.map((doc: any, i: number) => (
                        <div key={i} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl hover:bg-gray-100 transition border border-gray-100 group">
                          <div className="flex items-center gap-3">
                            <span className="text-xs font-mono text-gray-400 w-4">{i + 1}.</span>
                            <span className="text-sm font-medium text-gray-700">{doc.nome || 'Documento'}</span>
                          </div>
                          <a href={doc.arquivoUrl} target="_blank" rel="noreferrer" className="p-2 text-lie-green hover:bg-lie-green/10 rounded-lg transition" title="Baixar este arquivo">
                            <Download className="w-4 h-4" />
                          </a>
                        </div>
                      ))}
                      {modalDocs.data.entDocs.length === 0 && <p className="text-xs text-gray-400 italic ml-6">Nenhum documento na pasta da entidade.</p>}
                    </div>
                  </section>

                  {/* Seção Dirigentes */}
                  <section>
                    <div className="flex items-center gap-2 mb-3 text-blue-600 font-bold text-sm uppercase tracking-wider">
                      <Folder className="w-4 h-4" /> 2. Dirigentes
                    </div>
                    <div className="space-y-6 ml-4 border-l-2 border-gray-100 pl-4">
                      {modalDocs.data.dirigentes.map((dir: any, i: number) => (
                        <div key={i} className="space-y-2">
                          <div className="flex items-center justify-between text-sm font-bold text-gray-600">
                            <div className="flex items-center gap-2">
                              <User className="w-4 h-4" /> {dir.nome}
                            </div>
                            {dir.documentos.length > 0 && (
                              <button 
                                onClick={() => handleDownloadPartialZip(`${dir.nome.replace(/\s/g, '_')}_Documentos`, dir.documentos.map((d: any, j: number) => ({
                                  url: d.arquivoUrl,
                                  fileName: `${j + 1}. ${d.nome || 'Doc'}${d.arquivoUrl.toLowerCase().includes('.pdf') ? '.pdf' : ''}`
                                })))}
                                disabled={!!baixandoDocs}
                                className="text-[10px] bg-blue-50 text-blue-600 px-2 py-1 rounded-md hover:bg-blue-600 hover:text-white transition font-bold flex items-center gap-1"
                              >
                                <FileDown className="w-3 h-3" /> ZIP DIRIGENTE
                              </button>
                            )}
                          </div>
                          <div className="space-y-1">
                            {dir.documentos.map((doc: any, j: number) => (
                              <div key={j} className="flex items-center justify-between p-2 hover:bg-gray-50 rounded-lg transition group pl-2">
                                <div className="flex items-center gap-3">
                                  <span className="text-xs font-mono text-gray-300 w-4">{j + 1}.</span>
                                  <span className="text-sm text-gray-600">{doc.nome || 'Documento'}</span>
                                </div>
                                <a href={doc.arquivoUrl} target="_blank" rel="noreferrer" className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-md transition opacity-0 group-hover:opacity-100">
                                  <Download className="w-3.5 h-3.5" />
                                </a>
                              </div>
                            ))}
                            {dir.documentos.length === 0 && <p className="text-xs text-gray-400 italic ml-7">Sem documentos.</p>}
                          </div>
                        </div>
                      ))}
                      {modalDocs.data.dirigentes.length === 0 && <p className="text-xs text-gray-400 italic">Nenhum dirigente cadastrado.</p>}
                    </div>
                  </section>
                </>
              )}
            </div>

            <footer className="p-4 border-t bg-gray-50 flex items-center justify-end gap-3">
              <button onClick={() => setModalDocs(null)} className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg font-medium transition">
                Fechar
              </button>
              {modalDocs.data && (
                <button 
                  onClick={handleDownloadZipFromModal}
                  disabled={!!baixandoDocs}
                  className="inline-flex items-center gap-2 bg-lie-green hover:bg-lie-greenDark text-white px-6 py-2 rounded-lg font-bold transition shadow-lg disabled:opacity-50"
                >
                  {baixandoDocs ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Baixando ZIP ({baixandoDocs.current}/{baixandoDocs.total})</>
                  ) : (
                    <><FileDown className="w-4 h-4" /> Baixar Tudo em ZIP</>
                  )}
                </button>
              )}
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
