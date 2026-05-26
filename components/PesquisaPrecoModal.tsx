import React, { useState, useEffect, useRef } from 'react';
import { X, Search, Loader2, Check, FileText, Upload, Calendar, AlertCircle, Plus, Info, Globe, Shield, ExternalLink, Trash2 } from 'lucide-react';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { doc, setDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { storage, db } from '../lib/firebase';
import { buscarMateriaisLocal, consultarPrecosPraticados } from '../lib/apiCompras';
import type { ItemProjeto, PrecoReferencia } from '../types';
import type { GovernmentMaterial } from '../lib/apiCompras';

interface PesquisaPrecoModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: ItemProjeto;
  projetoTitulo?: string;
  entidadeNome?: string;
  onSave: () => void;
}

export default function PesquisaPrecoModal({ isOpen, onClose, item, projetoTitulo, entidadeNome, onSave }: PesquisaPrecoModalProps) {
  const [activeTab, setActiveTab] = useState<'compras' | 'manual'>('compras');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Estados da Aba Compras.gov.br
  const [searchTerm, setSearchTerm] = useState('');
  const [materiaisSemente, setMateriaisSemente] = useState<GovernmentMaterial[]>([]);
  const [materialSelecionado, setMaterialSelecionado] = useState<GovernmentMaterial | null>(null);
  const [precosGoverno, setPrecosGoverno] = useState<PrecoReferencia[]>([]);
  
  // Estados da Aba Registro Manual
  const [manualOrgao, setManualOrgao] = useState('');
  const [manualIdentificador, setManualIdentificador] = useState('');
  const [manualData, setManualData] = useState('');
  const [manualValor, setManualValor] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadingFile, setUploadingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Referências ativas selecionadas para a cesta
  const [cestaReferencias, setCestaReferencias] = useState<PrecoReferencia[]>([]);

  // Carregar referências já salvas no item, se existirem
  useEffect(() => {
    if (isOpen && item) {
      if (item.referencias && Array.isArray(item.referencias)) {
        setCestaReferencias(item.referencias);
      } else {
        setCestaReferencias([]);
      }
      
      // Resetar estados de busca
      setSearchTerm(item.nome || '');
      setMaterialSelecionado(null);
      setPrecosGoverno([]);
      
      // Buscar no semente local se houver termo
      if (item.nome) {
        const localResults = buscarMateriaisLocal(item.nome);
        setMateriaisSemente(localResults);
        if (localResults.length > 0) {
          // Auto-seleciona o primeiro se houver correspondência direta
          setMaterialSelecionado(localResults[0]);
        }
      }
      
      // Resetar estados do manual
      setManualOrgao('');
      setManualIdentificador('');
      setManualData('');
      setManualValor('');
      setSelectedFile(null);
      setUploadProgress(0);
    }
  }, [isOpen, item]);

  // Pesquisar localmente conforme digita
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const term = e.target.value;
    setSearchTerm(term);
    if (term.trim().length >= 2) {
      const results = buscarMateriaisLocal(term);
      setMateriaisSemente(results);
    } else {
      setMateriaisSemente([]);
    }
  };

  // Consultar preços públicos na API do Governo
  const handleConsultarPrecos = async (mat: GovernmentMaterial) => {
    setMaterialSelecionado(mat);
    setLoading(true);
    try {
      const resultados = await consultarPrecosPraticados(mat.codigoItem, item.valorUnitario);
      // Ordenar por valor unitário (descendente) para facilitar blindagem superior
      resultados.sort((a, b) => b.valorUnitario - a.valorUnitario);
      setPrecosGoverno(resultados);

      // Auto-selecionar todas as referências que são superiores ou iguais ao estimado do projeto
      const elegiveis = resultados.filter(p => p.valorUnitario >= item.valorUnitario);
      if (elegiveis.length > 0) {
        setCestaReferencias(prev => {
          // Filtra para evitar duplicados
          const novas = elegiveis.filter(e => 
            !prev.some(p => `${p.fonte}-${p.identificadorCompra}-${p.valorUnitario}` === `${e.fonte}-${e.identificadorCompra}-${e.valorUnitario}`)
          );
          return [...prev, ...novas];
        });
      }
    } catch (e) {
      console.error("Erro ao carregar preços praticados:", e);
      alert("Erro ao consultar a API pública. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  // Alternar seleção de preço na cesta
  const toggleSelecaoCesta = (ref: PrecoReferencia) => {
    const chave = `${ref.fonte}-${ref.identificadorCompra}-${ref.valorUnitario}`;
    const existe = cestaReferencias.some(
      r => `${r.fonte}-${r.identificadorCompra}-${r.valorUnitario}` === chave
    );

    if (existe) {
      setCestaReferencias(prev =>
        prev.filter(r => `${r.fonte}-${r.identificadorCompra}-${r.valorUnitario}` !== chave)
      );
    } else {
      // Validar regra de blindagem de preço (deve ser igual ou superior ao estimado do projeto)
      if (ref.valorUnitario < item.valorUnitario) {
        const confirmacao = window.confirm(
          `Atenção: O valor de R$ ${ref.valorUnitario.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} é INFERIOR ao valor estimado no projeto de R$ ${item.valorUnitario.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}. \n\nEm conformidade com a Instrução Normativa SEGES/ME nº 65/2021, cotar valores inferiores reduzirá o preço sugerido do projeto na consolidação, podendo inviabilizar a aquisição futura devido à defasagem inflacionária. \n\nDeseja prosseguir com esta cotação mesmo assim?`
        );
        if (!confirmacao) return;
      }
      setCestaReferencias(prev => [...prev, ref]);
    }
  };

  // Remover item direto da cesta
  const removerDaCesta = (idx: number) => {
    setCestaReferencias(prev => prev.filter((_, i) => i !== idx));
  };

  // Upload do PDF de origem manual para o Storage
  const handleUploadPdf = async (): Promise<{ url: string; fileName: string } | null> => {
    if (!selectedFile) return null;
    
    setUploadingFile(true);
    const docId = `manual_ref_${Date.now()}`;
    const ext = selectedFile.name.split('.').pop();
    const storagePath = `projects/${item.projectId}/referencias_precos/${docId}.${ext}`;
    const fileRef = ref(storage, storagePath);
    
    const uploadTask = uploadBytesResumable(fileRef, selectedFile);
    
    return new Promise((resolve, reject) => {
      uploadTask.on('state_changed',
        (snapshot) => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          setUploadProgress(progress);
        },
        (error) => {
          console.error("Erro no upload do PDF:", error);
          setUploadingFile(false);
          reject(error);
        },
        async () => {
          const url = await getDownloadURL(uploadTask.snapshot.ref);
          setUploadingFile(false);
          resolve({ url, fileName: selectedFile.name });
        }
      );
    });
  };

  // Adicionar Cotação Manual / Fomento
  const handleAdicionarManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualOrgao || !manualIdentificador || !manualData || !manualValor) {
      alert("Por favor, preencha todos os campos obrigatórios.");
      return;
    }

    const valorNum = parseFloat(manualValor.replace(',', '.'));
    if (isNaN(valorNum) || valorNum <= 0) {
      alert("Informe um valor unitário válido.");
      return;
    }

    // Validar blindagem superior
    if (valorNum < item.valorUnitario) {
      const confirmacao = window.confirm(
        `Atenção: O valor de R$ ${valorNum.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} é INFERIOR ao valor estimado no projeto de R$ ${item.valorUnitario.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}. \n\nDeseja adicionar esta cotação mesmo assim?`
      );
      if (!confirmacao) return;
    }

    if (!selectedFile) {
      alert("A Instrução Normativa SEGES/ME nº 65/2021 exige a comprovação documental e de localização física dos preços públicos. O anexo do PDF oficial de origem do Termo de Fomento / Colaboração ou Pregão é OBRIGATÓRIO.");
      return;
    }

    setLoading(true);
    try {
      const uploadRes = await handleUploadPdf();
      if (!uploadRes) {
        alert("Falha ao salvar o documento anexo.");
        setLoading(false);
        return;
      }

      const novaRef: PrecoReferencia = {
        orgaoLicitante: manualOrgao.toUpperCase(),
        identificadorCompra: manualIdentificador,
        dataHomologacao: manualData,
        valorUnitario: valorNum,
        fonte: 'fomento',
        localizacaoUrl: uploadRes.url,
        arquivoNome: uploadRes.fileName
      };

      setCestaReferencias(prev => [...prev, novaRef]);
      
      // Resetar form manual
      setManualOrgao('');
      setManualIdentificador('');
      setManualData('');
      setManualValor('');
      setSelectedFile(null);
      setUploadProgress(0);
      alert("Referência de preço público adicionada com sucesso!");
    } catch (e: any) {
      console.error(e);
      alert(`Erro ao adicionar: ${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  };

  // Calcular estatísticas da cesta em tempo real
  const calcularEstatisticas = () => {
    if (cestaReferencias.length === 0) {
      return { media: 0, mediana: 0 };
    }
    
    const valores = cestaReferencias.map(r => r.valorUnitario).sort((a, b) => a - b);
    
    // Média
    const soma = valores.reduce((acc, val) => acc + val, 0);
    const media = soma / valores.length;
    
    // Mediana
    let mediana = 0;
    const meio = Math.floor(valores.length / 2);
    if (valores.length % 2 === 0) {
      mediana = (valores[meio - 1] + valores[meio]) / 2;
    } else {
      mediana = valores[meio];
    }
    
    return { media, mediana };
  };

  const { media, mediana } = calcularEstatisticas();

  // Salvar cesta no Firestore
  const handleSalvarPesquisa = async () => {
    if (cestaReferencias.length === 0) {
      alert("Por favor, selecione ou adicione pelo menos uma referência de preço público.");
      return;
    }

    setSaving(true);
    try {
      const token = item.tokenPesquisa || generateToken();

      // Atualiza o documento do Item do Projeto
      const itemRef = doc(db, `projects/${item.projectId}/items`, item.id);
      await setDoc(itemRef, {
        pesquisado: true,
        referencias: cestaReferencias,
        mediaReferencia: media,
        medianaReferencia: mediana,
        tokenPesquisa: token,
        ultimoCodigoVinculado: materialSelecionado?.codigoItem || item.ultimoCodigoVinculado || null
      }, { merge: true });

      // Grava no Registro de Autenticidade Neutro e Desacoplado
      const validadorRef = doc(db, 'cotacoesValidadoras', token);
      await setDoc(validadorRef, {
        token,
        projectId: item.projectId,
        itemProjetoId: item.id,
        nome: item.nome,
        descricao: item.descricao || '',
        quantidade: item.quantidade,
        unidade: item.unidade,
        valorUnitarioEstimado: item.valorUnitario,
        referencias: cestaReferencias,
        mediaReferencia: media,
        medianaReferencia: mediana,
        projetoTitulo: projetoTitulo || "PROJETO ESPORTIVO",
        entidadeNome: entidadeNome || "PROPONENTE",
        criadoEm: serverTimestamp()
      });

      alert("Pesquisa de preços públicos homologada e vinculada com sucesso no âmbito da IN 65/2021!");
      onSave();
      onClose();
    } catch (e: any) {
      console.error(e);
      alert(`Erro ao salvar a pesquisa de preço: ${e?.message || e}`);
    } finally {
      setSaving(false);
    }
  };

  const generateToken = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let token = '';
    for (let i = 0; i < 32; i++) {
      token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return token;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in font-sans">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl h-[88vh] flex flex-col overflow-hidden animate-zoom-in border border-gray-100">
        
        {/* Cabeçalho */}
        <header className="bg-lie-ink p-4 flex items-center justify-between text-white border-b border-gray-800">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-lie-green rounded-lg">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-lg flex items-center gap-2">
                Pesquisa de Preços Públicos
                <span className="text-[10px] bg-lie-green text-white px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">IN 65/2021</span>
              </h3>
              <p className="text-xs text-gray-300">
                Item: <strong className="text-white">{item.nome}</strong> • Estimado Unitário: <strong className="text-lie-green">R$ {item.valorUnitario.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong>
              </p>
            </div>
          </div>
          <button onClick={onClose} className="hover:bg-white/10 p-2 rounded-full transition text-gray-400 hover:text-white">
            <X className="w-6 h-6" />
          </button>
        </header>

        {/* Corpo do Modal (Layout em duas colunas) */}
        <div className="flex-1 flex overflow-hidden">
          
          {/* Coluna da Esquerda: Abas e Buscas */}
          <div className="w-7/12 flex flex-col border-r border-gray-100 bg-gray-50/50 p-5 overflow-y-auto">
            
            {/* Seletor de Abas */}
            <div className="flex bg-gray-200 p-1 rounded-xl mb-4">
              <button
                onClick={() => setActiveTab('compras')}
                className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${
                  activeTab === 'compras' ? 'bg-white text-lie-ink shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <Globe className="w-4 h-4 inline-block mr-1.5 -mt-0.5" />
                Compras.gov.br / PNCP
              </button>
              <button
                onClick={() => setActiveTab('manual')}
                className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${
                  activeTab === 'manual' ? 'bg-white text-lie-ink shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <FileText className="w-4 h-4 inline-block mr-1.5 -mt-0.5" />
                Cotações Manuais / Fomento
              </button>
            </div>

            {/* Conteúdo Aba Compras.gov.br */}
            {activeTab === 'compras' && (
              <div className="space-y-4 flex-1 flex flex-col">
                <div className="p-3 bg-blue-50 text-blue-800 rounded-xl text-xs flex gap-2 border border-blue-100 leading-relaxed">
                  <Info className="w-4 h-4 shrink-0 text-blue-600 mt-0.5" />
                  <div>
                    <strong>Mecanismo de Resolução CATMAT:</strong> Digite o termo de busca para localizar o item no catálogo semente e consultar os preços homologados da API do governo.
                  </div>
                </div>

                {/* Caixa de Busca */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Buscar material no catálogo semente..."
                    value={searchTerm}
                    onChange={handleSearchChange}
                    className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-xl text-sm bg-white"
                  />
                </div>

                {/* Lista de Materiais Semente Localizados */}
                {materiaisSemente.length > 0 && !materialSelecionado && (
                  <div className="border border-gray-200 bg-white rounded-xl divide-y max-h-48 overflow-y-auto shadow-sm">
                    {materiaisSemente.map(m => (
                      <div
                        key={m.codigoItem}
                        onClick={() => handleConsultarPrecos(m)}
                        className="p-3 hover:bg-lie-green/5 cursor-pointer flex items-center justify-between transition-colors group"
                      >
                        <div className="flex-1 pr-4">
                          <div className="text-sm font-bold text-lie-ink group-hover:text-lie-green transition-colors">{m.nome}</div>
                          <div className="text-[10px] text-gray-400 font-mono">Código CATMAT: #{m.codigoItem} • {m.unidade}</div>
                        </div>
                        <span className="text-xs text-blue-600 font-bold shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">Consultar Preços &rarr;</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Exibição do Item Ativo Selecionado */}
                {materialSelecionado && (
                  <div className="p-3 bg-white border border-gray-200 rounded-xl flex items-center justify-between shadow-sm">
                    <div>
                      <span className="text-[9px] font-bold text-lie-green uppercase bg-lie-green/10 px-2 py-0.5 rounded-full">Material Vinculado</span>
                      <h4 className="font-bold text-lie-ink text-sm mt-1">{materialSelecionado.nome}</h4>
                      <p className="text-[10px] text-gray-500 leading-tight mt-0.5">{materialSelecionado.descricaoItem}</p>
                    </div>
                    <button
                      onClick={() => { setMaterialSelecionado(null); setPrecosGoverno([]); }}
                      className="text-xs text-red-500 hover:underline font-bold shrink-0 ml-4"
                    >
                      Alterar
                    </button>
                  </div>
                )}

                {/* Preços Praticados Retornados da API */}
                <div className="flex-1 flex flex-col">
                  <h4 className="text-xs font-bold text-gray-600 uppercase tracking-wider mb-2">Preços Públicos Homologados</h4>

                  {loading ? (
                    <div className="flex-1 flex flex-col items-center justify-center py-12 text-gray-400 bg-white border border-gray-100 rounded-xl">
                      <Loader2 className="w-8 h-8 animate-spin text-lie-green mb-2" />
                      <span className="text-xs font-semibold">Consultando API de Dados Abertos do Governo...</span>
                      <span className="text-[10px] text-gray-400 mt-1">Carregando cotações e bases do PNCP...</span>
                    </div>
                  ) : precosGoverno.length > 0 ? (
                    <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                      {precosGoverno.map((p, idx) => {
                        const chave = `${p.fonte}-${p.identificadorCompra}-${p.valorUnitario}`;
                        const isSelected = cestaReferencias.some(
                          r => `${r.fonte}-${r.identificadorCompra}-${r.valorUnitario}` === chave
                        );
                        const isLower = p.valorUnitario < item.valorUnitario;

                        return (
                          <div
                            key={idx}
                            onClick={() => toggleSelecaoCesta(p)}
                            className={`p-3 bg-white border rounded-xl hover:border-lie-green cursor-pointer transition-all flex items-center gap-3 ${
                              isSelected ? 'border-lie-green ring-2 ring-lie-green/10' : 'border-gray-200'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => {}}
                              className="rounded border-gray-300 text-lie-green focus:ring-lie-green w-4.5 h-4.5 pointer-events-none"
                            />
                            
                            <div className="flex-1">
                              <div className="flex items-start justify-between">
                                <span className="text-[10px] font-bold text-gray-500 uppercase font-mono max-w-[200px] truncate" title={p.orgaoLicitante}>
                                  {p.orgaoLicitante}
                                </span>
                                <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                                  p.fonte === 'pncp' ? 'bg-indigo-100 text-indigo-800' : 'bg-blue-100 text-blue-800'
                                }`}>
                                  {p.fonte}
                                </span>
                              </div>
                              
                              <h5 className="font-bold text-lie-ink text-xs mt-1">{p.identificadorCompra}</h5>
                              
                              <div className="flex justify-between items-center mt-2 pt-2 border-t border-dashed border-gray-100">
                                <span className="text-[10px] text-gray-400">Homologado em: {p.dataHomologacao}</span>
                                <div className="text-right">
                                  <span className={`text-sm font-extrabold ${isLower ? 'text-amber-600' : 'text-lie-green'}`}>
                                    {p.valorUnitario.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                  </span>
                                  {isLower && (
                                    <span className="block text-[8px] text-amber-500 font-bold uppercase tracking-tight -mt-0.5">Inferior ao estimado</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : materialSelecionado ? (
                    <div className="p-8 text-center text-gray-400 bg-white border border-dashed rounded-xl italic text-xs">
                      Nenhum preço homologado localizado na API. Tente buscar por outro termo semente.
                    </div>
                  ) : (
                    <div className="p-8 text-center text-gray-400 bg-white border border-dashed rounded-xl italic text-xs">
                      Selecione um material no catálogo semente acima para visualizar e selecionar referências.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Conteúdo Aba Registro Manual */}
            {activeTab === 'manual' && (
              <form onSubmit={handleAdicionarManual} className="space-y-4">
                <div className="p-3 bg-amber-50 text-amber-900 rounded-xl text-xs flex gap-2 border border-amber-200 leading-relaxed">
                  <AlertCircle className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
                  <div>
                    <strong>Cotação Manual e Legislação:</strong> Ideal para anexar Termos de Fomento, Termos de Colaboração ou Acordos de Cooperação anteriores. O anexo do documento PDF oficial que originou a cotação é <strong>OBRIGATÓRIO</strong> para fins de auditoria no PDF consolidado.
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">Órgão Licitante / Entidade Parceira *</label>
                    <input
                      type="text"
                      required
                      placeholder="Ex: SECRETARIA ESTADUAL DE ESPORTES - SP"
                      value={manualOrgao}
                      onChange={e => setManualOrgao(e.target.value)}
                      className="w-full border-gray-300 rounded-xl text-sm"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1">Identificador da Compra / Fomento *</label>
                      <input
                        type="text"
                        required
                        placeholder="Ex: Termo de Fomento nº 45/2025"
                        value={manualIdentificador}
                        onChange={e => setManualIdentificador(e.target.value)}
                        className="w-full border-gray-300 rounded-xl text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1">Data Assinatura / Homologação *</label>
                      <input
                        type="date"
                        required
                        value={manualData}
                        onChange={e => setManualData(e.target.value)}
                        className="w-full border-gray-300 rounded-xl text-sm"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1">Valor Unitário Praticado (R$) *</label>
                      <input
                        type="text"
                        required
                        placeholder="Ex: 145.00"
                        value={manualValor}
                        onChange={e => setManualValor(e.target.value)}
                        className="w-full border-gray-300 rounded-xl text-sm font-bold text-lie-ink"
                      />
                    </div>
                    
                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1">Origem Documental (PDF) *</label>
                      <div 
                        onClick={() => fileInputRef.current?.click()}
                        className={`border border-dashed rounded-xl p-2 flex flex-col items-center justify-center cursor-pointer hover:border-lie-green transition bg-white h-[38px] ${
                          selectedFile ? 'border-lie-green bg-lie-green/5' : 'border-gray-300'
                        }`}
                      >
                        {selectedFile ? (
                          <span className="text-[10px] text-lie-green font-bold truncate max-w-[180px]" title={selectedFile.name}>
                            📎 {selectedFile.name}
                          </span>
                        ) : (
                          <span className="text-[10px] text-gray-500 font-medium flex items-center gap-1">
                            <Upload className="w-3.5 h-3.5 text-gray-400" />
                            Anexar PDF Origem
                          </span>
                        )}
                      </div>
                      <input type="file" ref={fileInputRef} className="hidden" accept="application/pdf" onChange={e => {
                        if (e.target.files && e.target.files[0]) setSelectedFile(e.target.files[0]);
                      }} />
                    </div>
                  </div>

                  {uploadProgress > 0 && uploadProgress < 100 && (
                    <div className="w-full bg-gray-200 rounded-full h-1.5 mt-2">
                      <div className="bg-lie-green h-1.5 rounded-full transition-all" style={{ width: `${uploadProgress}%` }}></div>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading || uploadingFile}
                    className="w-full mt-2 bg-lie-ink hover:bg-lie-ink/90 text-white font-bold text-xs py-2.5 rounded-xl shadow-sm transition flex items-center justify-center gap-1.5"
                  >
                    <Plus className="w-4 h-4" />
                    Adicionar Cotação Manual na Cesta
                  </button>
                </div>
              </form>
            )}

          </div>

          {/* Coluna da Direita: Cesta e Estatísticas */}
          <div className="w-5/12 flex flex-col bg-white p-5 overflow-y-auto">
            <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Sua Cesta de Cotações</h4>

            {/* Listagem da Cesta */}
            <div className="flex-1 space-y-2.5 max-h-[360px] overflow-y-auto pr-1">
              {cestaReferencias.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center text-gray-400 italic text-xs py-16 border border-dashed rounded-xl bg-gray-50/50">
                  <Package className="w-8 h-8 text-gray-300 mb-2" />
                  Sua cesta está vazia.<br />Adicione ou selecione cotações ao lado.
                </div>
              ) : (
                cestaReferencias.map((r, idx) => (
                  <div key={idx} className="p-3 bg-gray-50 border border-gray-200 rounded-xl flex items-center justify-between group">
                    <div className="flex-1 pr-2 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[8px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider ${
                          r.fonte === 'fomento' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'
                        }`}>
                          {r.fonte}
                        </span>
                        <span className="text-[10px] text-gray-500 truncate block max-w-[130px] font-mono">
                          {r.orgaoLicitante}
                        </span>
                      </div>
                      <h5 className="font-bold text-lie-ink text-xs mt-1 truncate">{r.identificadorCompra}</h5>
                      <span className="text-[10px] text-lie-green font-extrabold block mt-0.5">
                        {r.valorUnitario.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                      </span>
                    </div>
                    <button
                      onClick={() => removerDaCesta(idx)}
                      className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition"
                      title="Remover"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Conformidade IN 65 */}
            {cestaReferencias.length > 0 && cestaReferencias.length < 3 && (
              <div className="mt-3 p-2 bg-amber-50 text-amber-800 rounded-lg text-[10px] font-bold border border-amber-200 flex gap-1.5 leading-snug">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 text-amber-600" />
                <span>IN 65/2021 (Art. 5º): É recomendado selecionar ao menos 3 referências de preços para garantir a ampla competitividade.</span>
              </div>
            )}
            {cestaReferencias.length >= 3 && (
              <div className="mt-3 p-2 bg-lie-green/10 text-lie-green rounded-lg text-[10px] font-bold border border-lie-green/20 flex gap-1.5 items-center">
                <Check className="w-4 h-4 shrink-0 text-lie-green" />
                <span>Cesta em plena conformidade legal com o Art. 5º da IN 65/2021!</span>
              </div>
            )}

            {/* Painel Estatístico */}
            <div className="mt-4 p-4 bg-lie-ink text-white rounded-2xl shadow-premium space-y-3">
              <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest block border-b border-gray-700 pb-1">Análise Estatística da Cesta</span>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-[10px] text-gray-400 block uppercase">Média Aritmética</span>
                  <strong className="text-base text-white font-black">
                    {media.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                  </strong>
                </div>
                <div>
                  <span className="text-[10px] text-gray-400 block uppercase">Mediana Linear</span>
                  <strong className="text-base text-lie-green font-black">
                    {mediana.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                  </strong>
                </div>
              </div>

              <div className="text-[9px] text-gray-300 leading-normal flex gap-1 pt-1 border-t border-gray-800">
                <Shield className="w-4 h-4 shrink-0 text-lie-green" />
                <span>O valor médio cotado servirá de justificativa de mercado para blindagem do item.</span>
              </div>
            </div>

          </div>

        </div>

        {/* Rodapé do Modal */}
        <footer className="p-4 bg-gray-50 border-t flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2 font-bold text-sm text-gray-500 hover:bg-gray-100 rounded-xl transition"
          >
            Cancelar
          </button>
          <button
            onClick={handleSalvarPesquisa}
            disabled={saving || cestaReferencias.length === 0}
            className="bg-lie-green hover:bg-lie-greenDark text-white px-8 py-2 rounded-xl font-bold text-sm shadow-sm transition flex items-center gap-2 disabled:opacity-50"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {saving ? 'Homologando Pesquisa...' : 'Homologar & Salvar Pesquisa'}
          </button>
        </footer>

      </div>
    </div>
  );
}

// Simple fallback icon in case Package isn't exported correctly
function Package(props: any) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  );
}
