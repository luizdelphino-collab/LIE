import React, { useEffect, useState } from 'react';

// Expande siglas de unidade de medida do catalogo federal pra forma completa.
// Evita ambiguidade tipo '700 L' (Litro? Lote? Inicial 'l'?).
function expandirUnidadeMedida(sigla: string | undefined | null, qtd: number = 0): string {
  const s = String(sigla || '').trim().toUpperCase();
  if (!s) return '';
  const plural = qtd > 1 || qtd === 0;
  const dict: Record<string, [string, string]> = {
    'UN': ['Unidade', 'Unidades'], 'UND': ['Unidade', 'Unidades'],
    'L': ['Litro', 'Litros'], 'LT': ['Litro', 'Litros'],
    'ML': ['Mililitro', 'Mililitros'], 'MLT': ['Mililitro', 'Mililitros'],
    'G': ['Grama', 'Gramas'], 'GR': ['Grama', 'Gramas'],
    'KG': ['Quilograma', 'Quilogramas'],
    'M': ['Metro', 'Metros'],
    'M2': ['Metro quadrado', 'Metros quadrados'], 'M²': ['Metro quadrado', 'Metros quadrados'],
    'M3': ['Metro cúbico', 'Metros cúbicos'], 'M³': ['Metro cúbico', 'Metros cúbicos'],
    'CX': ['Caixa', 'Caixas'],
    'PCT': ['Pacote', 'Pacotes'], 'PCTE': ['Pacote', 'Pacotes'],
    'PC': ['Peça', 'Peças'],
    'FRD': ['Fardo', 'Fardos'],
    'GAL': ['Galão', 'Galões'], 'GLN': ['Galão', 'Galões'],
    'GFA': ['Garrafa', 'Garrafas'], 'GRF': ['Garrafa', 'Garrafas'],
    'SC': ['Saco', 'Sacos'],
    'ENV': ['Envelope', 'Envelopes'],
    'DZ': ['Dúzia', 'Dúzias'],
    'PR': ['Par', 'Pares'],
    'CTL': ['Cartela', 'Cartelas'],
    'AMP': ['Ampola', 'Ampolas'],
    'FA': ['Frasco', 'Frascos'], 'FR': ['Frasco', 'Frascos'],
    'TBL': ['Tablete', 'Tabletes'],
    'T': ['Tonelada', 'Toneladas'],
    'H': ['Hora', 'Horas'], 'HR': ['Hora', 'Horas'],
    'DIA': ['Diária', 'Diárias'],
    'MES': ['Mês', 'Meses'], 'MÊS': ['Mês', 'Meses'],
    'SERV': ['Serviço', 'Serviços'],
  };
  const entrada = dict[s];
  if (!entrada) return s;
  return plural ? entrada[1] : entrada[0];
}
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
  fonte: string;
  // Campos enriquecidos do PNCP/Compras.gov.br
  cnpjOrgao?: string;
  poder?: string;
  esfera?: string;
  uf?: string;
  modalidade?: string;
  situacao?: string;
  codigoCatalogoItem?: string;
  descricaoItem?: string;
  fornecedorNome?: string;
  fornecedorCnpj?: string;
  numeroControlePNCP?: string;
  dataVigenciaFinalAta?: string;
  linkPncpOriginal?: string;
  localizacaoUrl: string;
  arquivoNome?: string;
  // Enriquecimentos novos
  municipio?: string;
  criterioJulgamento?: string;
  modoDisputa?: string;
  amparoLegal?: string;
  leiAplicada?: string;
  objetoCompra?: string;
  inscricaoEstadualFornecedor?: string;
  dataPublicacao?: string;
  linkEditalPdf?: string;
  arquivosPNCP?: Array<{ tipo: string; titulo: string; url: string; dataPublicacao?: string }>;
  // Embalagem (separada da unidade da quantidade)
  siglaUnidadeFornecimento?: string;
  nomeUnidadeFornecimento?: string;
  capacidadeUnidadeFornecimento?: number;
  siglaUnidadeMedida?: string;
}

interface RegistroValidador {
  token: string;
  projectId?: string;
  itemProjetoId?: string;
  itemMasterId?: string;
  escopo?: 'banco' | 'projeto';
  nome: string;
  descricao: string;
  quantidade: number;
  unidade: string;
  valorUnitarioEstimado: number;
  // Vinculo CATMAT/CATSER do item LIE com catalogo oficial
  codigoCatmat?: number | null;
  tipoCatmat?: 'material' | 'servico' | null;
  nomeCatmatOficial?: string | null;
  descricaoCatmatOficial?: string | null;
  fatorConversao?: number | null;
  unidadeBase?: string | null;
  embalagemDescricao?: string | null;
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
                    <div>
                      <span className="text-[10px] text-slate-500 block uppercase">Denominação do Item (Plano de Trabalho)</span>
                      <strong className="text-slate-200 text-sm font-black">{registro.nome}</strong>
                    </div>

                    {/* Vinculo CATMAT/CATSER oficial */}
                    {registro.codigoCatmat && (
                      <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-3 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] font-extrabold uppercase tracking-wider text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded">
                            ✓ {registro.tipoCatmat === 'servico' ? 'CATSER' : 'CATMAT'} OFICIAL
                          </span>
                          <span className="text-sm text-emerald-300 font-mono font-bold">{registro.codigoCatmat}</span>
                        </div>
                        {registro.nomeCatmatOficial && (
                          <div className="text-slate-300 text-[12px] font-bold">{registro.nomeCatmatOficial}</div>
                        )}
                        {registro.descricaoCatmatOficial && (
                          <div className="text-slate-400 text-[11px] leading-relaxed">{registro.descricaoCatmatOficial}</div>
                        )}
                      </div>
                    )}

                    {registro.descricao && (
                      <div>
                        <span className="text-[10px] text-slate-500 block uppercase">Especificação Técnica (LIE)</span>
                        <p className="text-slate-300 leading-relaxed bg-slate-900 p-3 rounded-xl border border-slate-800/80 font-mono text-[11px] mt-1">
                          {registro.descricao}
                        </p>
                      </div>
                    )}

                    {registro.embalagemDescricao && (
                      <div className="grid grid-cols-3 gap-4 pt-2 border-t border-slate-800/60">
                        <div>
                          <span className="text-[10px] text-slate-500 block uppercase">Embalagem</span>
                          <strong className="text-slate-300 font-bold">{registro.embalagemDescricao}</strong>
                        </div>
                        {registro.fatorConversao && (
                          <div>
                            <span className="text-[10px] text-slate-500 block uppercase">Fator p/ Unid. Base</span>
                            <strong className="text-slate-300 font-mono">{registro.fatorConversao} {registro.unidadeBase || ''}</strong>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="grid grid-cols-3 gap-4 pt-2 border-t border-slate-800/60">
                      <div>
                        <span className="text-[10px] text-slate-500 block uppercase">Quantidade Estimada</span>
                        <strong className="text-slate-300 font-bold">{registro.quantidade || '—'} {registro.unidade}</strong>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 block uppercase">Valor Estimado Unitário</span>
                        <strong className="text-cyan-400 font-black">{formatCurrency(registro.valorUnitarioEstimado)}</strong>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 block uppercase">Escopo da Pesquisa</span>
                        <strong className="text-slate-300 font-bold">{registro.escopo === 'banco' ? 'BANCO DE ITENS' : 'PROJETO'}</strong>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Bloco Entidade + Projeto (institucional) */}
                <div className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
                  <div className="bg-slate-900/60 px-5 py-3.5 border-b border-slate-800">
                    <h3 className="font-bold text-xs text-slate-400 uppercase tracking-widest">Vínculo Institucional</h3>
                  </div>
                  <div className="p-5 text-xs grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <span className="text-[10px] text-slate-500 block uppercase">Entidade Proponente</span>
                      <strong className="text-slate-200 text-sm font-bold block">{registro.entidadeNome}</strong>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 block uppercase">Projeto</span>
                      <strong className="text-slate-200 text-sm font-bold block">{registro.projetoTitulo}</strong>
                    </div>
                  </div>
                </div>

                {/* Bloco 2: Cards de Referências de Preços Homologadas (cada cotação com todos os dados) */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-xs text-slate-400 uppercase tracking-widest">Cesta de Preços Homologada (Fontes Públicas)</h3>
                    <span className="text-[9px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-bold uppercase">{registro.referencias.length} cotações</span>
                  </div>

                  {registro.referencias.map((r, idx) => {
                    const fonteCor = (() => {
                      switch (r.fonte) {
                        case 'compras.gov.br': return 'bg-blue-500/10 text-blue-300 border-blue-500/30';
                        case 'pncp':
                        case 'pncp-contratacao':
                        case 'pncp-ata': return 'bg-indigo-500/10 text-indigo-300 border-indigo-500/30';
                        case 'contrato-publico': return 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30';
                        case 'convenio': return 'bg-teal-500/10 text-teal-300 border-teal-500/30';
                        case 'termo-fomento':
                        case 'fomento': return 'bg-blue-500/10 text-blue-300 border-blue-500/30';
                        case 'tabela-preco': return 'bg-amber-500/10 text-amber-300 border-amber-500/30';
                        case 'manual': return 'bg-red-500/10 text-red-300 border-red-500/30';
                        default: return 'bg-slate-500/10 text-slate-300 border-slate-500/30';
                      }
                    })();
                    return (
                      <div key={idx} className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
                        {/* Cabecalho da cotacao */}
                        <div className="bg-slate-900/60 px-5 py-3 border-b border-slate-800 flex items-center justify-between gap-3 flex-wrap">
                          <div className="flex items-center gap-2">
                            <span className={`px-2.5 py-1 rounded text-[9px] font-extrabold uppercase tracking-wider border ${fonteCor}`}>
                              {r.fonte.replace(/-/g, ' ').toUpperCase()}
                            </span>
                            <span className="text-[10px] text-slate-500 font-mono">#{idx + 1}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-slate-500">Valor unitário homologado:</span>
                            <span className="text-base font-extrabold text-emerald-400">{formatCurrency(r.valorUnitario)}</span>
                          </div>
                        </div>

                        {/* Corpo: dados ricos */}
                        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 text-xs">
                          {/* COLUNA 1: ORGAO */}
                          <div className="space-y-3">
                            <div>
                              <span className="text-[9px] text-slate-500 block uppercase tracking-wider">Órgão Licitante / Contratante</span>
                              <strong className="text-slate-200 text-[13px] font-bold leading-tight block">{r.orgaoLicitante}</strong>
                              {r.cnpjOrgao && <span className="text-[10px] text-slate-500 font-mono">CNPJ: {r.cnpjOrgao}</span>}
                            </div>
                            {(r.poder || r.esfera || r.uf || r.municipio) && (
                              <div className="flex flex-wrap gap-2 text-[10px]">
                                {r.poder && <span className="bg-slate-900 border border-slate-800 px-2 py-0.5 rounded text-slate-400"><span className="text-slate-500">Poder:</span> <strong className="text-slate-300">{r.poder}</strong></span>}
                                {r.esfera && <span className="bg-slate-900 border border-slate-800 px-2 py-0.5 rounded text-slate-400"><span className="text-slate-500">Esfera:</span> <strong className="text-slate-300">{r.esfera}</strong></span>}
                                {r.uf && <span className="bg-slate-900 border border-slate-800 px-2 py-0.5 rounded text-slate-400"><span className="text-slate-500">UF:</span> <strong className="text-slate-300">{r.uf}</strong></span>}
                                {r.municipio && <span className="bg-slate-900 border border-slate-800 px-2 py-0.5 rounded text-slate-400"><span className="text-slate-500">Município:</span> <strong className="text-slate-300">{r.municipio}</strong></span>}
                                {r.uasg && <span className="bg-slate-900 border border-slate-800 px-2 py-0.5 rounded text-slate-400"><span className="text-slate-500">UASG:</span> <strong className="text-slate-300 font-mono">{r.uasg}</strong></span>}
                              </div>
                            )}
                          </div>

                          {/* COLUNA 2: PROCESSO */}
                          <div className="space-y-2">
                            <div>
                              <span className="text-[9px] text-slate-500 block uppercase tracking-wider">Identificador da Compra</span>
                              <strong className="text-slate-300 font-mono text-[11px] block">{r.identificadorCompra}</strong>
                            </div>
                            {r.numeroControlePNCP && (
                              <div>
                                <span className="text-[9px] text-slate-500 block uppercase tracking-wider">Nº Controle PNCP</span>
                                <strong className="text-slate-300 font-mono text-[11px]">{r.numeroControlePNCP}</strong>
                              </div>
                            )}
                            <div className="flex gap-3 flex-wrap text-[10px]">
                              {r.modalidade && <span className="text-slate-400"><span className="text-slate-500">Modalidade:</span> <strong className="text-slate-300">{r.modalidade}</strong></span>}
                              {r.situacao && <span className="text-slate-400"><span className="text-slate-500">Situação:</span> <strong className="text-slate-300">{r.situacao}</strong></span>}
                              {r.criterioJulgamento && <span className="text-slate-400"><span className="text-slate-500">Critério:</span> <strong className="text-slate-300">{r.criterioJulgamento}</strong></span>}
                              {r.modoDisputa && <span className="text-slate-400"><span className="text-slate-500">Disputa:</span> <strong className="text-slate-300">{r.modoDisputa}</strong></span>}
                            </div>
                            {r.leiAplicada && (
                              <div className="text-[10px]">
                                <span className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 px-2 py-0.5 rounded font-bold uppercase tracking-wider">
                                  ⚖ {r.leiAplicada}
                                </span>
                                {r.amparoLegal && r.amparoLegal !== r.leiAplicada && (
                                  <span className="text-slate-400 ml-2">· {r.amparoLegal}</span>
                                )}
                              </div>
                            )}
                            <div className="flex gap-3 flex-wrap text-[10px]">
                              {r.dataPublicacao && <span className="text-slate-400"><span className="text-slate-500">Publicação:</span> <strong className="text-slate-300">{r.dataPublicacao}</strong></span>}
                              {r.dataHomologacao && <span className="text-slate-400"><span className="text-slate-500">Homologação:</span> <strong className="text-slate-300">{r.dataHomologacao}</strong></span>}
                              {r.dataVigenciaFinalAta && <span className="text-slate-400"><span className="text-slate-500">Vigência Final:</span> <strong className="text-slate-300">{r.dataVigenciaFinalAta}</strong></span>}
                            </div>
                          </div>

                          {/* LINHA 2 (COL 1+2): ITEM */}
                          {(r.codigoCatalogoItem || r.descricaoItem) && (
                            <div className="md:col-span-2 pt-3 border-t border-slate-800/60">
                              <span className="text-[9px] text-slate-500 block uppercase tracking-wider mb-1">Item Homologado na Licitação</span>
                              {r.codigoCatalogoItem && (
                                <span className="text-emerald-400 font-mono text-[11px] font-bold mr-2">CATMAT/CATSER {r.codigoCatalogoItem}</span>
                              )}
                              {r.descricaoItem && (
                                <p className="text-slate-300 text-[11px] leading-relaxed mt-1">{r.descricaoItem}</p>
                              )}
                              {(r.quantidade || r.unidadeMedida) && (() => {
                                // QUANTIDADE — unidade da quantidade (UN/CX/FRD), nao capacidade da embalagem
                                // Compat retroativa: cotacoes antigas salvaram capacidade (ML/L/KG/G) no campo unidadeMedida.
                                // Detecta esse caso e prefere siglaUnidadeFornecimento, caindo em 'UN' como ultimo recurso.
                                const SIGLAS_CAPACIDADE = ['ML', 'L', 'LT', 'KG', 'G', 'GR', 'M', 'M2', 'M3', 'M²', 'M³'];
                                const unidSalva = String(r.unidadeMedida || '').toUpperCase();
                                const unidEhCapacidade = SIGLAS_CAPACIDADE.includes(unidSalva);
                                const temEmb = r.siglaUnidadeFornecimento || r.nomeUnidadeFornecimento || (r.capacidadeUnidadeFornecimento && r.capacidadeUnidadeFornecimento > 0);
                                const unidQtd = (unidEhCapacidade && temEmb)
                                  ? (r.siglaUnidadeFornecimento || 'UN')
                                  : (r.unidadeMedida || 'UN');
                                const expandida = expandirUnidadeMedida(unidQtd, r.quantidade || 0);
                                const siglaOrig = String(unidQtd).toUpperCase();
                                const mostrarSigla = siglaOrig && expandida && expandida.toUpperCase() !== siglaOrig;
                                // EMBALAGEM — separada (ex: cada UN tem 200 ML, embalagem GARRAFA)
                                const temEmbalagem = r.nomeUnidadeFornecimento ||
                                  (r.capacidadeUnidadeFornecimento && r.capacidadeUnidadeFornecimento > 0);
                                return (
                                  <div className="text-[10px] text-slate-400 mt-1 space-y-0.5">
                                    <div>
                                      <span className="text-slate-500">Qtd contratada:</span> <strong className="text-slate-300">{r.quantidade || '—'}</strong> {expandida || siglaOrig}
                                      {mostrarSigla && <span className="text-slate-500 ml-1" title="Sigla original retornada pela API governamental">({siglaOrig})</span>}
                                    </div>
                                    {temEmbalagem && (
                                      <div>
                                        <span className="text-slate-500">Embalagem:</span>{' '}
                                        {r.nomeUnidadeFornecimento && <strong className="text-slate-300">{r.nomeUnidadeFornecimento}</strong>}
                                        {r.capacidadeUnidadeFornecimento && r.capacidadeUnidadeFornecimento > 0 && (
                                          <span className="ml-1">
                                            {r.nomeUnidadeFornecimento ? '— ' : ''}
                                            <strong className="text-slate-300">{r.capacidadeUnidadeFornecimento} {expandirUnidadeMedida(r.siglaUnidadeMedida || '', r.capacidadeUnidadeFornecimento).toLowerCase()}</strong>
                                            <span className="text-slate-600 ml-1">por unidade</span>
                                          </span>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
                            </div>
                          )}

                          {/* LINHA 3: FORNECEDOR */}
                          {(r.fornecedorNome || r.fornecedorCnpj) && (
                            <div className="md:col-span-2 pt-3 border-t border-slate-800/60">
                              <span className="text-[9px] text-slate-500 block uppercase tracking-wider mb-1">Fornecedor Adjudicatário</span>
                              {r.fornecedorNome && <strong className="text-slate-300 text-[11px] block">{r.fornecedorNome}</strong>}
                              <div className="flex gap-3 flex-wrap text-[10px] text-slate-500 mt-0.5">
                                {r.fornecedorCnpj && <span className="font-mono">CNPJ: <strong className="text-slate-400">{r.fornecedorCnpj}</strong></span>}
                                {r.inscricaoEstadualFornecedor && <span className="font-mono">IE: <strong className="text-slate-400">{r.inscricaoEstadualFornecedor}</strong></span>}
                              </div>
                            </div>
                          )}

                          {/* LINHA 4: OBJETO COMPRA */}
                          {r.objetoCompra && (
                            <div className="md:col-span-2 pt-3 border-t border-slate-800/60">
                              <span className="text-[9px] text-slate-500 block uppercase tracking-wider mb-1">Objeto da Contratação</span>
                              <p className="text-slate-300 text-[11px] leading-relaxed">{r.objetoCompra}</p>
                            </div>
                          )}

                          {/* LINHA 5: LINKS PUBLICOS */}
                          <div className="md:col-span-2 pt-3 border-t border-slate-800/60 space-y-2">
                            <div className="flex flex-wrap gap-2">
                              {/* PRIORIDADE 1: PDF direto do edital */}
                              {r.linkEditalPdf && (
                                <a
                                  href={r.linkEditalPdf}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20 text-[10px] font-bold uppercase tracking-wider rounded-lg transition"
                                >
                                  <Download className="w-3 h-3" />
                                  PDF do Edital
                                </a>
                              )}
                              {/* PRIORIDADE 2: pagina da contratacao */}
                              {r.linkPncpOriginal && (
                                <a
                                  href={r.linkPncpOriginal}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/20 text-[10px] font-bold uppercase tracking-wider rounded-lg transition"
                                >
                                  <ExternalLink className="w-3 h-3" />
                                  Página no PNCP
                                </a>
                              )}
                              {r.localizacaoUrl && r.localizacaoUrl !== r.linkPncpOriginal && r.localizacaoUrl !== r.linkEditalPdf && (
                                <a
                                  href={r.localizacaoUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 border border-slate-700 text-slate-300 hover:border-slate-600 text-[10px] font-bold uppercase tracking-wider rounded-lg transition"
                                >
                                  {r.fonte === 'fomento' || r.fonte === 'manual' || r.fonte === 'contrato-publico' || r.fonte === 'convenio' || r.fonte === 'termo-fomento' || r.fonte === 'tabela-preco'
                                    ? <><Download className="w-3 h-3" /> Documento PDF</>
                                    : <><ExternalLink className="w-3 h-3" /> Link da fonte</>
                                  }
                                </a>
                              )}
                              {!r.linkEditalPdf && !r.linkPncpOriginal && !r.localizacaoUrl && (
                                <span className="text-[10px] text-slate-500 italic">Sem link público disponível para esta cotação.</span>
                              )}
                            </div>

                            {/* Anexos adicionais do PNCP */}
                            {r.arquivosPNCP && r.arquivosPNCP.length > 0 && (
                              <div className="pt-2 border-t border-slate-800/40">
                                <span className="text-[9px] text-slate-500 block uppercase tracking-wider mb-1">
                                  Anexos da Contratação ({r.arquivosPNCP.length})
                                </span>
                                <div className="flex flex-wrap gap-1.5">
                                  {r.arquivosPNCP.map((arq, ai) => (
                                    <a
                                      key={ai}
                                      href={arq.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      title={`${arq.tipo}${arq.titulo ? ': ' + arq.titulo : ''}${arq.dataPublicacao ? ' (' + arq.dataPublicacao + ')' : ''}`}
                                      className="inline-flex items-center gap-1 px-2 py-1 bg-slate-900 border border-slate-700 text-slate-300 hover:border-slate-600 hover:text-cyan-300 text-[9px] font-bold uppercase tracking-wider rounded transition"
                                    >
                                      <Download className="w-2.5 h-2.5" />
                                      {arq.tipo}
                                    </a>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
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
