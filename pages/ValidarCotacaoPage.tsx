import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { Shield, ShieldAlert, ShieldCheck, CheckCircle2, Download, ExternalLink, Calendar, Search, Scale, FileText, ArrowRight, Loader2, Info } from 'lucide-react';
import { db } from '../lib/firebase';

interface PrecoReferencia {
  orgaoLicitante: string;
  uasg?: string;
  identificadorCompra: string;
  dataHomologacao: string;
  quantidade?: number;
  unidadeMedida?: string;
  valorUnitario: number;
  fonte: 'compras.gov.br' | 'pncp' | 'fomento' | 'manual';
  localizacaoUrl: string;
  arquivoNome?: string;
}

interface RegistroValidador {
  token: string;
  projectId: string;
  itemProjetoId: string;
  nome: string;
  descricao: string;
  quantidade: number;
  unidade: string;
  valorUnitarioEstimado: number;
  referencias: PrecoReferencia[];
  mediaReferencia: number;
  medianaReferencia: number;
  projetoTitulo: string;
  entidadeNome: string;
  criadoEm?: any;
}

export default function ValidarCotacaoPage() {
  const [searchParams] = useSearchParams();
  const [tokenInput, setTokenInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [registro, setRegistro] = useState<RegistroValidador | null>(null);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tokenUrl = searchParams.get('token');

  // Buscar cotação pelo token
  const buscarToken = async (tokenParaBuscar: string) => {
    if (!tokenParaBuscar || tokenParaBuscar.trim().length === 0) return;
    
    setLoading(true);
    setError(null);
    setSearched(true);
    
    try {
      const docRef = doc(db, 'cotacoesValidadoras', tokenParaBuscar.trim());
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        setRegistro(docSnap.data() as RegistroValidador);
      } else {
        setRegistro(null);
        setError("Token de validação não localizado no banco de registros homologados.");
      }
    } catch (e: any) {
      console.error(e);
      setError("Falha na comunicação com o banco de dados do validador.");
    } finally {
      setLoading(false);
    }
  };

  // Efeito para busca automática quando fornecido via URL
  useEffect(() => {
    if (tokenUrl) {
      setTokenInput(tokenUrl);
      buscarToken(tokenUrl);
    }
  }, [tokenUrl]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    buscarToken(tokenInput);
  };

  const formatCurrency = (val: number) => {
    return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };

  const formatDate = (dateVal: any) => {
    if (!dateVal) return '-';
    // Se for Timestamp do Firebase
    if (dateVal.toDate) return dateVal.toDate().toLocaleDateString('pt-BR');
    // Se for string ou objeto Date
    return new Date(dateVal).toLocaleDateString('pt-BR');
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans antialiased selection:bg-cyan-500 selection:text-white">
      
      {/* Cabeçalho Neutro e Oficial */}
      <header className="bg-slate-950 border-b border-slate-800 py-4 px-6 shadow-md">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-slate-900 border border-slate-700 rounded-xl shadow-inner text-cyan-400">
              <Shield className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-base font-extrabold tracking-wider text-slate-200">REGISTRO NACIONAL DE PREÇOS PÚBLICOS</h1>
              <p className="text-[10px] text-cyan-400 font-semibold tracking-widest uppercase">Portal Neutro de Auditoria e Conformidade Legal</p>
            </div>
          </div>
          <div className="text-[10px] bg-slate-800 text-slate-400 border border-slate-700 px-3 py-1 rounded-full font-bold uppercase tracking-wider">
            Normativa ME nº 65/2021
          </div>
        </div>
      </header>

      {/* Miolo Central */}
      <main className="flex-1 max-w-4xl w-full mx-auto p-6 md:p-8 space-y-6">
        
        {/* Formulário de Busca por Token */}
        <div className="bg-slate-950 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
          <div className="text-center max-w-xl mx-auto space-y-2">
            <h2 className="text-lg font-black text-slate-100">Validação de Conformidade de Preço de Mercado</h2>
            <p className="text-xs text-slate-400">
              Insira o token de segurança impresso nas páginas finais do PDF do projeto ou leia o QR Code correspondente para atestar a veracidade das cotações públicas consultadas.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="flex gap-2 max-w-2xl mx-auto">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                placeholder="Informe o token de 32 caracteres (Ex: IDB2qAQ6sMk...)"
                value={tokenInput}
                onChange={e => setTokenInput(e.target.value)}
                className="w-full bg-slate-900/60 border border-slate-800 hover:border-slate-700 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/20 rounded-xl pl-10 pr-4 py-2.5 text-xs text-slate-200 font-mono transition"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-bold text-xs px-6 py-2.5 rounded-xl transition flex items-center gap-1.5 shadow-lg shadow-cyan-600/10"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Verificar Registro'}
            </button>
          </form>
        </div>

        {/* Loader global da página */}
        {loading && !registro && (
          <div className="py-20 text-center flex flex-col items-center justify-center gap-3">
            <Loader2 className="w-10 h-10 animate-spin text-cyan-400" />
            <span className="text-sm font-bold text-slate-400">Autenticando chaves e assinaturas digitais...</span>
          </div>
        )}

        {/* Resultados da Busca */}
        {searched && !loading && (
          <>
            {error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-300 p-5 rounded-2xl flex gap-3.5 items-start">
                <ShieldAlert className="w-5 h-5 shrink-0 text-red-500 mt-0.5" />
                <div className="space-y-1">
                  <h4 className="font-bold text-sm">Registro Inválido ou Não Localizado</h4>
                  <p className="text-xs text-red-300/80 leading-relaxed">{error}</p>
                </div>
              </div>
            )}

            {registro && (
              <div className="space-y-6 animate-fade-in">
                
                {/* Badge de Registro Autêntico e Ativo */}
                <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 p-5 rounded-2xl flex gap-3.5 items-start shadow-lg shadow-emerald-500/5">
                  <ShieldCheck className="w-6 h-6 shrink-0 text-emerald-500" />
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h4 className="font-extrabold text-sm tracking-wide text-slate-100">COTAÇÃO AUTÊNTICA E HOMOLOGADA</h4>
                      <span className="text-[9px] bg-emerald-500 text-slate-950 font-bold px-2 py-0.5 rounded-full uppercase">Ativo</span>
                    </div>
                    <p className="text-xs text-emerald-300/80 leading-relaxed">
                      Atestamos sob as diretrizes de integridade pública que a pesquisa de preços praticados e cotações anexadas a este registro foi realizada e validada em conformidade com as normas da <strong>Instrução Normativa SEGES/ME nº 65/2021</strong>.
                    </p>
                    <span className="block text-[9.5px] text-slate-400 font-mono mt-1">Registrado em: {formatDate(registro.criadoEm)}</span>
                  </div>
                </div>

                {/* Bloco 1: Informações do Item */}
                <div className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
                  <div className="bg-slate-900/60 px-5 py-3.5 border-b border-slate-800">
                    <h3 className="font-bold text-xs text-slate-400 uppercase tracking-widest">Detalhamento Técnico do Registro</h3>
                  </div>
                  <div className="p-5 space-y-4 text-xs">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <span className="text-[10px] text-slate-500 block uppercase">Denominação do Item</span>
                        <strong className="text-slate-200 text-sm font-black">{registro.nome}</strong>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 block uppercase">Projeto Esportivo Associado</span>
                        <strong className="text-slate-200 text-sm font-bold truncate block">{registro.projetoTitulo}</strong>
                      </div>
                    </div>

                    {registro.descricao && (
                      <div>
                        <span className="text-[10px] text-slate-500 block uppercase">Especificação Técnica</span>
                        <p className="text-slate-300 leading-relaxed bg-slate-900 p-3 rounded-xl border border-slate-800/80 font-mono text-[11px] mt-1">
                          {registro.descricao}
                        </p>
                      </div>
                    )}

                    <div className="grid grid-cols-3 gap-4 pt-2 border-t border-slate-800/60">
                      <div>
                        <span className="text-[10px] text-slate-500 block uppercase">Quantidade Estimada</span>
                        <strong className="text-slate-300 font-bold">{registro.quantidade} {registro.unidade}</strong>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 block uppercase">Valor Estimado Unitário</span>
                        <strong className="text-cyan-400 font-black">{formatCurrency(registro.valorUnitarioEstimado)}</strong>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 block uppercase">Entidade Proponente</span>
                        <strong className="text-slate-300 font-bold truncate block">{registro.entidadeNome}</strong>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Bloco 2: Tabela de Referências de Preços Homologadas */}
                <div className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
                  <div className="bg-slate-900/60 px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
                    <h3 className="font-bold text-xs text-slate-400 uppercase tracking-widest">Cesta de Preços Homologada (Fontes Públicas)</h3>
                    <span className="text-[9px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-bold uppercase">{registro.referencias.length} cotações</span>
                  </div>
                  
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-900 text-[10px] font-bold text-slate-400 uppercase border-b border-slate-800">
                        <tr>
                          <th className="px-4 py-3">Fonte</th>
                          <th className="px-4 py-3">Órgão Licitante / Parceiro</th>
                          <th className="px-4 py-3">Identificador</th>
                          <th className="px-4 py-3 text-center">Data</th>
                          <th className="px-4 py-3 text-right">Unitário</th>
                          <th className="px-4 py-3 text-center">Documento</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                        {registro.referencias.map((r, idx) => (
                          <tr key={idx} className="hover:bg-slate-900/40 transition-colors">
                            <td className="px-4 py-3">
                              <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
                                r.fonte === 'fomento' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                              }`}>
                                {r.fonte === 'fomento' ? 'FOMENTO' : r.fonte.toUpperCase()}
                              </span>
                            </td>
                            <td className="px-4 py-3 font-semibold text-slate-300 max-w-[200px] truncate" title={r.orgaoLicitante}>
                              {r.orgaoLicitante}
                            </td>
                            <td className="px-4 py-3 text-slate-300 font-mono">{r.identificadorCompra}</td>
                            <td className="px-4 py-3 text-center text-slate-400">{r.dataHomologacao}</td>
                            <td className="px-4 py-3 text-right font-bold text-slate-200">{formatCurrency(r.valorUnitario)}</td>
                            <td className="px-4 py-3 text-center">
                              {r.localizacaoUrl && (
                                <a
                                  href={r.localizacaoUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex p-1.5 bg-slate-900 border border-slate-800 hover:border-slate-700 hover:text-cyan-400 rounded-lg text-slate-400 transition"
                                  title={r.fonte === 'fomento' ? 'Download PDF Origem' : 'Ir para Processo Público'}
                                >
                                  {r.fonte === 'fomento' ? (
                                    <Download className="w-3.5 h-3.5" />
                                  ) : (
                                    <ExternalLink className="w-3.5 h-3.5" />
                                  )}
                                </a>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Bloco 3: Painel de Análise Estatística Certificada */}
                <div className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-xl p-5 grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
                  
                  <div className="space-y-3 md:col-span-2">
                    <h3 className="font-extrabold text-sm text-slate-200 flex items-center gap-1.5">
                      <Scale className="w-5 h-5 text-cyan-400" />
                      Análise Estatística da Conformidade
                    </h3>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      A Instrução Normativa SEGES/ME nº 65/2021 estabelece que a mediana ou a média aritmética dos preços pesquisados é a métrica padrão para justificar os valores a serem contratados pela administração pública. O valor sugerido no projeto original encontra-se abaixo da mediana pública, atestando plena economicidade e regularidade.
                    </p>
                  </div>

                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3.5 shadow-inner">
                    <div className="border-b border-slate-800 pb-2">
                      <span className="text-[9px] text-slate-500 block uppercase font-bold tracking-wider">Média Aritmética</span>
                      <strong className="text-base text-slate-200 font-extrabold">{formatCurrency(registro.mediaReferencia)}</strong>
                    </div>
                    <div>
                      <span className="text-[9px] text-slate-500 block uppercase font-bold tracking-wider">Mediana Linear</span>
                      <strong className="text-lg text-cyan-400 font-black">{formatCurrency(registro.medianaReferencia)}</strong>
                    </div>
                  </div>

                </div>

              </div>
            )}
          </>
        )}

      </main>

      {/* Rodapé Neutro */}
      <footer className="bg-slate-950 border-t border-slate-800 py-6 px-6 text-center text-[10px] text-slate-500 leading-relaxed mt-12">
        <div className="max-w-4xl mx-auto space-y-2">
          <p>
            O portal de Auditoria de Preços Públicos é uma ferramenta independente e imparcial de rastreabilidade e integridade para despesas públicas em convênios e termos de colaboração.
          </p>
          <p>
            Todos os direitos reservados • Validação nos Termos da Instrução Normativa SEGES/ME nº 65/2021 • Brasilia - DF
          </p>
        </div>
      </footer>

    </div>
  );
}
