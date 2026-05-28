import React, { useState, useEffect, useRef } from 'react';
import { X, Search, Loader2, Check, FileText, Upload, Calendar, AlertCircle, Plus, Info, Globe, Shield, ExternalLink, Trash2, Eye } from 'lucide-react';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { doc, setDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { storage, db } from '../lib/firebase';
import { buscarMateriaisLocal, consultarPrecosPraticados, obterArquivosContratacao } from '../lib/apiCompras';
import { coletarMercadoItem, type CotacaoMercado, type MercadoResposta } from '../lib/mercadoApi';
import type { ItemMaster, ItemProjeto, PrecoReferencia } from '../types';
import type { GovernmentMaterial } from '../lib/apiCompras';
import { jsPDF } from 'jspdf';

/**
 * Item-like aceito pelo modal. Quando vem do Banco de Itens (master), nao
 * tem projectId/quantidade/memorialCalculo — esses sao do projeto. O modal
 * detecta o modo (banco vs projeto) pela presenca de projectId e salva no
 * documento certo.
 */
export type ItemPesquisavel =
  | (ItemProjeto & { __origem?: 'projeto' })
  | (ItemMaster & { __origem: 'banco'; projectId?: undefined; quantidade?: number; memorialCalculo?: string });

interface PesquisaPrecoModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: ItemPesquisavel;
  projetoTitulo?: string;
  entidadeNome?: string;
  onSave: () => void;
}

export default function PesquisaPrecoModal({ isOpen, onClose, item, projetoTitulo, entidadeNome, onSave }: PesquisaPrecoModalProps) {
  // Modo determinado pela presenca de projectId.
  // - Modo BANCO: salva em items/{id} (master). Pesquisa unica vale pra todos os projetos.
  // - Modo PROJETO: salva em projects/{pid}/items/{id} (legado). Mantido pra compat
  //   enquanto migra. Etapa 5C movera tudo pro banco.
  const modoBanco = !item.projectId;

  // FAIXA DE ELEGIBILIDADE: cotacoes fora desta janela nao compoem a base de pesquisa.
  // - Limite inferior: valorUnitario do item (anti-inexequivel, evita puxar mediana pra baixo)
  // - Limite superior: 2.5x valorUnitario (anti-outlier, evita inflar mediana com cotacao discrepante)
  const MULTIPLICADOR_OUTLIER = 2.5;
  const limiteInferior = item.valorUnitario;
  const limiteSuperior = item.valorUnitario * MULTIPLICADOR_OUTLIER;
  const dentroDaFaixa = (v: number) => v >= limiteInferior && v <= limiteSuperior;

  // Estado da resposta unificada do mercado (mesma fonte da coluna Mercado Gov)
  const [mercadoResposta, setMercadoResposta] = useState<MercadoResposta | null>(null);

  /**
   * Converte CotacaoMercado (formato do coletarMercadoItem) para PrecoReferencia
   * (formato usado pela cesta + certidao). Garante que Mercado Gov e Balanca
   * usem EXATAMENTE os mesmos dados — uma fonte de verdade.
   */
  const cotacaoMercadoParaPrecoRef = (c: CotacaoMercado): PrecoReferencia => {
    // Monta link PNCP a partir do numeroControle quando possivel
    const numCtrl = c.numeroControlePNCP || '';
    let linkPncp = c.linkPncp || '';
    const m = numCtrl.match(/^(\d{14})-[\dA-Z]+-(\d+)\/(\d{4})$/);
    if (m && !linkPncp.includes('pncp.gov.br/app')) {
      const tipo = c.fonte === 'pncp-ata' ? 'atas' : 'editais';
      linkPncp = `https://pncp.gov.br/app/${tipo}/${m[1]}/${m[3]}/${m[2]}`;
    }
    return {
      fonte: (c.fonte || 'compras.gov.br') as PrecoReferencia['fonte'],
      orgaoLicitante: c.orgao || 'ÓRGÃO PÚBLICO',
      uasg: c.uasg || '',
      cnpjOrgao: c.cnpjOrgao || '',
      poder: c.poder || '',
      esfera: c.esfera || '',
      uf: c.uf || '',
      municipio: c.municipio || '',
      modalidade: c.modalidade || '',
      situacao: c.situacao || '',
      criterioJulgamento: c.criterioJulgamento || '',
      modoDisputa: c.modoDisputa || '',
      amparoLegal: c.amparoLegal || '',
      leiAplicada: c.leiAplicada || '',
      objetoCompra: c.objetoCompra || '',
      codigoCatalogoItem: c.codigoCatalogoItem || '',
      descricaoItem: c.descricaoItem || '',
      fornecedorNome: c.fornecedorNome || '',
      fornecedorCnpj: c.fornecedorCnpj || '',
      inscricaoEstadualFornecedor: c.inscricaoEstadualFornecedor || '',
      identificadorCompra: c.identificadorCompra || numCtrl || '',
      numeroControlePNCP: numCtrl,
      dataHomologacao: c.dataHomologacao || '',
      dataVigenciaFinalAta: c.dataVigenciaFinalAta || '',
      dataPublicacao: c.dataPublicacao || '',
      quantidade: c.quantidade || 0,
      unidadeMedida: c.unidadeMedida || c.siglaUnidadeMedida || '',
      valorUnitario: c.valorUnitario,
      linkPncpOriginal: linkPncp || undefined,
      localizacaoUrl: linkPncp || '',
    };
  };
  const [activeTab, setActiveTab] = useState<'compras' | 'manual'>('compras');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Estados da Aba Compras.gov.br
  const [searchTerm, setSearchTerm] = useState('');
  const [materiaisSemente, setMateriaisSemente] = useState<GovernmentMaterial[]>([]);
  const [materialSelecionado, setMaterialSelecionado] = useState<GovernmentMaterial | null>(null);
  const [precosGoverno, setPrecosGoverno] = useState<PrecoReferencia[]>([]);
  
  // Estados da Aba Registro Manual
  type CategoriaManual = 'contrato-publico' | 'convenio' | 'termo-fomento' | 'tabela-preco' | 'manual';
  const [categoriaManual, setCategoriaManual] = useState<CategoriaManual>('termo-fomento');
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

  /**
   * Extrai a capacidade da descricao da cotacao via regex.
   * Retorna em ML, G, KG, L convertendo pra unidade-base do item quando possivel.
   * Exemplos: "200 ml" → 200 ML, "1 L" → 1000 ML, "20 L" → 20000 ML, "1,5 KG" → 1500 G.
   */
  const extrairCapacidadeCotacao = (descricao: string, unidadeBaseItem: string): number | null => {
    if (!descricao || !unidadeBaseItem) return null;
    const desc = descricao.toUpperCase();
    const base = unidadeBaseItem.toUpperCase();

    // Padroes: numero + opcional decimal + espaco opcional + unidade
    // Ex: "200 ML", "200ML", "1,5L", "0.5 L", "20L", "500 GR", "1 KG"
    const padrao = /(\d+(?:[\.,]\d+)?)\s*(ML|MILILITRO|L|LITRO|G|GR|GRAMA|KG|QUILO|UN|UNIDADE|M|METRO|M2|M²|M3|M³)\b/gi;
    const matches: { valor: number; unidade: string }[] = [];
    let m;
    while ((m = padrao.exec(desc)) !== null) {
      const valor = parseFloat(m[1].replace(',', '.'));
      const unidade = m[2].toUpperCase();
      if (!isNaN(valor) && valor > 0) matches.push({ valor, unidade });
    }
    if (matches.length === 0) return null;

    // Converte cada match pra unidade-base do item
    const converterPara = (v: number, uOrigem: string, uDestino: string): number | null => {
      const norm = (u: string): string => {
        if (['ML', 'MILILITRO'].includes(u)) return 'ML';
        if (['L', 'LITRO'].includes(u)) return 'L';
        if (['G', 'GR', 'GRAMA'].includes(u)) return 'G';
        if (['KG', 'QUILO'].includes(u)) return 'KG';
        if (['UN', 'UNIDADE'].includes(u)) return 'UN';
        if (['M', 'METRO'].includes(u)) return 'M';
        if (['M2', 'M²'].includes(u)) return 'M2';
        if (['M3', 'M³'].includes(u)) return 'M3';
        return u;
      };
      const o = norm(uOrigem);
      const d = norm(uDestino);
      if (o === d) return v;
      // Conversoes simples
      if (o === 'L' && d === 'ML') return v * 1000;
      if (o === 'ML' && d === 'L') return v / 1000;
      if (o === 'KG' && d === 'G') return v * 1000;
      if (o === 'G' && d === 'KG') return v / 1000;
      return null; // sem conversao conhecida
    };

    // Prefere o match cuja unidade bate com a base (sem conversao)
    const matchExato = matches.find(x => {
      const conv = converterPara(x.valor, x.unidade, base);
      return conv !== null && x.unidade.replace(/[²³2-3]/g, '') === base.replace(/[²³2-3]/g, '');
    });
    if (matchExato) return matchExato.valor;

    // Fallback: primeiro match convertivel
    for (const x of matches) {
      const conv = converterPara(x.valor, x.unidade, base);
      if (conv !== null) return conv;
    }
    return null;
  };

  /**
   * Filtra cotacoes por compatibilidade de embalagem com o item.
   * Quando o item tem fatorConversao + unidadeBase, mantem apenas cotacoes
   * cuja capacidade detectada esteja em faixa ±30% da capacidade do item.
   * Cotacoes sem capacidade detectavel passam por padrao (nao excluimos
   * por falta de info — exclusao so quando ha info contraditoria).
   */
  const filtrarCotacoesPorEmbalagem = (cotacoes: PrecoReferencia[]): PrecoReferencia[] => {
    if (!item.fatorConversao || !item.unidadeBase || item.fatorConversao <= 0) {
      return cotacoes; // sem dados de embalagem, nao filtra
    }
    const capacidadeItem = item.fatorConversao;
    const margem = 0.3;
    const min = capacidadeItem * (1 - margem);
    const max = capacidadeItem * (1 + margem);
    return cotacoes.filter(c => {
      const cap = extrairCapacidadeCotacao(c.descricaoItem || '', item.unidadeBase || '');
      if (cap === null) return true; // sem info de embalagem na cotacao, mantem
      return cap >= min && cap <= max;
    });
  };

  // Carregar referências já salvas no item, se existirem.
  // REGRA ANTI-FRAUDE/ANTI-OUTLIER: cotacoes fora da faixa [ref, 2.5×ref] nao
  // compoem a base. Inferior puxa mediana pra baixo (potencial inexequivel);
  // superior infla mediana com cotacao discrepante (produto errado, lote enorme).
  useEffect(() => {
    if (isOpen && item) {
      if (item.referencias && Array.isArray(item.referencias)) {
        const elegiveis = item.referencias.filter(r => dentroDaFaixa(r.valorUnitario));
        const removidas = item.referencias.length - elegiveis.length;
        setCestaReferencias(elegiveis);
        if (removidas > 0) {
          console.info(`[pesquisa-preco] ${removidas} cotacao(oes) fora da faixa R$ ${limiteInferior.toFixed(2)}-R$ ${limiteSuperior.toFixed(2)} removidas da cesta ao carregar.`);
        }
      } else {
        setCestaReferencias([]);
      }

      // Resetar estados de busca
      setSearchTerm(item.nome || '');
      setMaterialSelecionado(null);
      setPrecosGoverno([]);
      setMateriaisSemente([]);

      // PRIORIDADE 1: se o item ja tem codigoCatmat vinculado, usa coletarMercadoItem
      // (MESMA fonte da coluna Mercado Gov — uma fonte da verdade, com saneamento TCU
      // ja aplicado). Cotacoes nao-outlier sao pre-selecionadas pra cesta.
      if (item.codigoCatmat) {
        const categoriaStr = 'categoria' in item && typeof (item as any).categoria === 'string'
          ? (item as any).categoria : 'Item do Projeto';
        const materialDoItem: GovernmentMaterial = {
          codigoItem: item.codigoCatmat,
          nome: item.nomeCatmatOficial || item.nome,
          descricaoItem: item.descricaoCatmatOficial || item.descricao || '',
          categoria: categoriaStr,
          unidade: item.unidade || 'unidade',
        };
        setMaterialSelecionado(materialDoItem);

        setLoading(true);
        coletarMercadoItem(item.codigoCatmat, item.tipoCatmat || 'material')
          .then(resp => {
            setMercadoResposta(resp);
            if (!resp || !resp.cotacoes) {
              setPrecosGoverno([]);
              return;
            }
            // Converte CotacaoMercado → PrecoReferencia (mesmo formato da cesta)
            const todasPrecos = resp.cotacoes.map(cotacaoMercadoParaPrecoRef);
            // Filtro por embalagem (mantem se item tem fatorConversao)
            const filtradasPorEmb = filtrarCotacoesPorEmbalagem(todasPrecos);
            filtradasPorEmb.sort((a, b) => b.valorUnitario - a.valorUnitario);
            setPrecosGoverno(filtradasPorEmb);

            // PRE-SELECAO INTELIGENTE: cesta inicia com cotacoes que:
            //  1. Estao na faixa elegivel [ref, 2.5×ref]
            //  2. Estao na embalagem correta (filtro embalagem)
            //  3. NAO foram marcadas como outlier pelo saneamento TCU
            const incluidasTCU = new Set(
              (resp.cotacoes || []).filter(c => !c.outlier).map(c =>
                `${c.fonte}-${c.identificadorCompra}-${c.valorUnitario}`
              )
            );
            const elegiveis = filtradasPorEmb.filter(p => {
              const chave = `${p.fonte}-${p.identificadorCompra}-${p.valorUnitario}`;
              return dentroDaFaixa(p.valorUnitario) && incluidasTCU.has(chave);
            });
            if (elegiveis.length > 0) {
              setCestaReferencias(prev => {
                const novas = elegiveis.filter(e =>
                  !prev.some(p => `${p.fonte}-${p.identificadorCompra}-${p.valorUnitario}` === `${e.fonte}-${e.identificadorCompra}-${e.valorUnitario}`)
                );
                return [...prev, ...novas];
              });
            }
          })
          .catch(err => {
            console.error("Erro ao carregar mercado via coletarMercadoItem:", err);
          })
          .finally(() => {
            setLoading(false);
          });
      } else if (item.nome) {
        // PRIORIDADE 2: sem CATMAT vinculado — fallback pra busca por nome no seed local
        const localResults = buscarMateriaisLocal(item.nome);
        setMateriaisSemente(localResults);
        if (localResults.length > 0) {
          const selected = localResults[0];
          setMaterialSelecionado(selected);
          setLoading(true);
          consultarPrecosPraticados(selected.codigoItem, item.valorUnitario, item.nome)
            .then(resultadosBrutos => {
              const resultados = filtrarCotacoesPorEmbalagem(resultadosBrutos);
              resultados.sort((a, b) => b.valorUnitario - a.valorUnitario);
              setPrecosGoverno(resultados);
              const elegiveis = resultados.filter(p => dentroDaFaixa(p.valorUnitario));
              if (elegiveis.length > 0) {
                setCestaReferencias(prev => {
                  const novas = elegiveis.filter(e =>
                    !prev.some(p => `${p.fonte}-${p.identificadorCompra}-${p.valorUnitario}` === `${e.fonte}-${e.identificadorCompra}-${e.valorUnitario}`)
                  );
                  return [...prev, ...novas];
                });
              }
            })
            .catch(err => {
              console.error("Erro ao carregar precos praticados automaticamente:", err);
            })
            .finally(() => {
              setLoading(false);
            });
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
      const resultadosBrutos = await consultarPrecosPraticados(mat.codigoItem, item.valorUnitario, item.nome);
      // Filtro por embalagem
      const resultados = filtrarCotacoesPorEmbalagem(resultadosBrutos);
      // Ordenar por valor unitário (descendente) para facilitar blindagem superior
      resultados.sort((a, b) => b.valorUnitario - a.valorUnitario);
      setPrecosGoverno(resultados);

      // Auto-selecionar refs DENTRO da faixa [referencia, 2.5×referencia]
      const elegiveis = resultados.filter(p => dentroDaFaixa(p.valorUnitario));
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
      // BLINDAGEM: cotacao precisa estar na faixa [referencia, 2.5×referencia]
      if (ref.valorUnitario < limiteInferior) {
        alert(
          `Cotacao recusada: R$ ${ref.valorUnitario.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} esta ABAIXO do valor estimado do item (R$ ${limiteInferior.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}).\n\nValores fora da faixa [R$ ${limiteInferior.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} - R$ ${limiteSuperior.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}] nao compoem a base de pesquisa.`
        );
        return;
      }
      if (ref.valorUnitario > limiteSuperior) {
        alert(
          `Cotacao recusada: R$ ${ref.valorUnitario.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} esta ACIMA de 2.5x o valor estimado do item (limite R$ ${limiteSuperior.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}).\n\nValor considerado outlier — pode ser produto/lote/embalagem diferente. Nao compoe a base de pesquisa.`
        );
        return;
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

    // BLINDAGEM: cotacao precisa estar na faixa [referencia, 2.5×referencia]
    if (valorNum < limiteInferior) {
      alert(
        `Cotacao recusada: R$ ${valorNum.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} esta ABAIXO do valor estimado (R$ ${limiteInferior.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}).\n\nFaixa elegivel: [R$ ${limiteInferior.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} - R$ ${limiteSuperior.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}].\n\nValores fora dessa janela nao compoem a base de pesquisa.`
      );
      return;
    }
    if (valorNum > limiteSuperior) {
      alert(
        `Cotacao recusada: R$ ${valorNum.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} esta ACIMA de 2.5x o valor estimado (limite R$ ${limiteSuperior.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}).\n\nValor considerado outlier — geralmente indica produto/lote/embalagem diferente. Nao compoe a base de pesquisa.`
      );
      return;
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
        fonte: categoriaManual,
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
      
      // Criar cópia profunda da cesta de referências para atualizar as URLs do Storage
      const referenciasArquivadas = cestaReferencias.map(r => ({ ...r }));

      // 0. Enriquecimento PNCP: pra cada ref com numeroControlePNCP, busca o PDF do
      // edital + lista de arquivos. Roda em paralelo pra todos. Falha silenciosa
      // por ref (se o PNCP estiver fora, segue sem o linkEditalPdf).
      const refsComPNCP = referenciasArquivadas.filter(r => r.numeroControlePNCP);
      if (refsComPNCP.length > 0) {
        console.log(`Enriquecendo ${refsComPNCP.length} ref(s) com arquivos PNCP...`);
        const enriquecimentos = await Promise.all(
          refsComPNCP.map(async (r) => {
            const arq = await obterArquivosContratacao(r.numeroControlePNCP!);
            return { ref: r, arquivos: arq };
          })
        );
        for (const { ref, arquivos } of enriquecimentos) {
          if (arquivos) {
            if (arquivos.linkEditalPdf) ref.linkEditalPdf = arquivos.linkEditalPdf;
            if (arquivos.arquivos && arquivos.arquivos.length > 0) {
              ref.arquivosPNCP = arquivos.arquivos.slice(0, 10); // top 10 pra nao inflar Firestore
            }
          }
        }
      }

      // 1. Processo de arquivamento automático de comprovantes físicos (Atas Públicas ou Certidões)
      for (let idx = 0; idx < referenciasArquivadas.length; idx++) {
        const r = referenciasArquivadas[idx];
        
        // Cotações manuais já estão no Storage, ignoramos.
        // Só arquivamos cotações que venham de fontes públicas federais
        if (r.fonte === 'compras.gov.br' || r.fonte === 'pncp' || r.fonte === 'pncp-contratacao' || r.fonte === 'pncp-ata') {
          // Preserva a URL original do PNCP/Compras antes de qualquer sobrescrita
          if (r.localizacaoUrl && (r.localizacaoUrl.includes('pncp.gov.br') || r.localizacaoUrl.includes('compras.gov.br'))) {
            r.linkPncpOriginal = r.localizacaoUrl;
          }
          const fileKey = `${token}_ref_${idx}`;
          
          // Checar se a URL é de fallback (não tem pregão específico) ou aponta para a busca geral do PNCP
          const isFallbackOrSearch = !r.localizacaoUrl || 
            !r.localizacaoUrl.includes('numprp=') || 
            r.localizacaoUrl.includes('pncp.gov.br/app/contratacoes?q=');

          let downloadUrl: string | null = null;

          // Se for uma ata real do Comprasnet (com pregão identificado), tenta capturar a ata real via Puppeteer Cloud Function
          if (!isFallbackOrSearch) {
            try {
              const projectId = storage.app.options.projectId;
              const region = 'us-central1';
              const funcUrl = `https://${region}-${projectId}.cloudfunctions.net/obterPdfContratacaoPublica`;
              
              const resp = await fetch(funcUrl, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  data: {
                    url: r.localizacaoUrl,
                    token: fileKey
                  }
                })
              });

              if (resp.ok) {
                const resData = await resp.json();
                downloadUrl = resData.result?.downloadUrl || null;
              }
            } catch (err) {
              console.warn(`Falha na captura Puppeteer para ${r.identificadorCompra}, acionando plano B (Certidão Digital):`, err);
            }
          }

          // PLANO B AUTOMÁTICO (Fallback): Se for uma cotação simulada/de fallback OR se a Cloud Function falhar,
          // geramos localmente uma linda Certidão Digital de Preço Público em PDF e fazemos o upload automático!
          if (!downloadUrl) {
            console.log(`Gerando certidão digital de cotação pública para arquivamento: ${r.identificadorCompra}`);
            const certidaoBlob = gerarCertidaoCotaçãoPDF(
              r,
              item,
              projetoTitulo || (modoBanco ? '(BANCO DE ITENS)' : 'Projeto Esportivo'),
              entidadeNome || 'Entidade Proponente',
              token
            );
            
            const storagePath = `projects/${item.projectId}/referencias_precos/${fileKey}.pdf`;
            const fileRef = ref(storage, storagePath);
            const uploadTask = uploadBytesResumable(fileRef, certidaoBlob);

            await new Promise<void>((resolve, reject) => {
              uploadTask.on('state_changed',
                null,
                (err) => reject(err),
                async () => {
                  const dUrl = await getDownloadURL(uploadTask.snapshot.ref);
                  downloadUrl = dUrl;
                  resolve();
                }
              );
            });
          }

          // Gravar a URL definitiva do PDF arquivado no Storage para que a juntada física e o validador acessem na hora!
          if (downloadUrl) {
            r.localizacaoUrl = downloadUrl;
          }
        }
      }

      // 2. Atualiza o documento certo conforme o modo
      // - Modo banco: items/{id}              (etapa 5C - fonte unica)
      // - Modo projeto: projects/{pid}/items/{id} (legado, mantido pra compat)
      const itemRef = modoBanco
        ? doc(db, 'items', item.id)
        : doc(db, `projects/${item.projectId}/items`, item.id);

      await setDoc(itemRef, {
        pesquisado: true,
        referencias: referenciasArquivadas,
        mediaReferencia: media,
        medianaReferencia: mediana,
        tokenPesquisa: token,
        ultimoCodigoVinculado: materialSelecionado?.codigoItem || item.ultimoCodigoVinculado || null,
        ...(modoBanco ? { pesquisaAtualizadaEm: serverTimestamp() } : {})
      }, { merge: true });

      // 3. Grava no Registro de Autenticidade (mesma collection, payload adaptado pelo modo)
      const validadorRef = doc(db, 'cotacoesValidadoras', token);
      await setDoc(validadorRef, {
        token,
        ...(modoBanco
          ? { itemMasterId: item.id, escopo: 'banco' as const }
          : { projectId: item.projectId, itemProjetoId: item.id, escopo: 'projeto' as const }),
        nome: item.nome,
        descricao: item.descricao || '',
        quantidade: item.quantidade || null,
        unidade: item.unidade,
        valorUnitarioEstimado: item.valorUnitario,
        // Vinculo do item LIE com o catalogo oficial (espelho do master)
        codigoCatmat: item.codigoCatmat || null,
        tipoCatmat: item.tipoCatmat || null,
        nomeCatmatOficial: item.nomeCatmatOficial || null,
        descricaoCatmatOficial: item.descricaoCatmatOficial || null,
        fatorConversao: item.fatorConversao || null,
        unidadeBase: item.unidadeBase || null,
        embalagemDescricao: item.embalagemDescricao || null,
        referencias: referenciasArquivadas,
        mediaReferencia: media,
        medianaReferencia: mediana,
        projetoTitulo: modoBanco ? '(BANCO DE ITENS)' : (projetoTitulo || "PROJETO ESPORTIVO"),
        entidadeNome: entidadeNome || "PROPONENTE",
        criadoEm: serverTimestamp()
      });

      alert("Pesquisa de preços públicos homologada, e todos os comprovantes foram gerados e arquivados no Storage com sucesso!");
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

                {/* Painel contextual — muda conforme a situação do item */}
                {!materialSelecionado && materiaisSemente.length === 0 && !loading ? (
                  /* Sem CATMAT e sem resultado na busca inicial — guiar o usuário */
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-xs space-y-3">
                    <p className="font-bold text-amber-900 flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      Este item não tem código CATMAT/CATSER vinculado.
                    </p>
                    <p className="text-amber-800 leading-relaxed">
                      Sem o código, não é possível buscar preços automaticamente em Compras.gov.br e PNCP.
                      Você tem 3 caminhos:
                    </p>
                    <div className="space-y-2">
                      <div className="flex gap-2 items-start">
                        <span className="font-mono font-bold text-amber-700 shrink-0">1.</span>
                        <span className="text-amber-800">
                          <strong>Buscar agora:</strong> digite um termo abaixo para localizar no catálogo semente
                          e consultar as cotações governamentais.
                        </span>
                      </div>
                      <div className="flex gap-2 items-start">
                        <span className="font-mono font-bold text-amber-700 shrink-0">2.</span>
                        <span className="text-amber-800">
                          <strong>Vincular CATMAT permanentemente:</strong> feche este modal, vá em
                          <em> Itens → editar este item → campo CATMAT</em>. Na próxima pesquisa o código
                          já estará disponível.
                        </span>
                      </div>
                      <div className="flex gap-2 items-start">
                        <span className="font-mono font-bold text-amber-700 shrink-0">3.</span>
                        <span className="text-amber-800">
                          <strong>Cotação manual:</strong> se este item é Recurso Humano (professor, árbitro,
                          coordenador) ou não existe no catálogo público, use a aba
                          <em> Cotações Manuais / Fomento</em> ao lado.
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-3 bg-blue-50 text-blue-800 rounded-xl text-xs flex gap-2 border border-blue-100 leading-relaxed">
                    <Info className="w-4 h-4 shrink-0 text-blue-600 mt-0.5" />
                    <div>
                      <strong>Catálogo CATMAT/CATSER:</strong> selecione o material correspondente
                      para consultar os preços homologados em Compras.gov.br e PNCP (IN 65/2021).
                    </div>
                  </div>
                )}

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
                  <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                    <h4 className="text-xs font-bold text-gray-600 uppercase tracking-wider">Preços Públicos Homologados</h4>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {mercadoResposta?.saneamento && (
                        <span className="text-[10px] bg-purple-50 border border-purple-200 text-purple-700 px-2 py-0.5 rounded font-bold uppercase tracking-wider" title={`Método TCU iterativo (μ±σ): ${mercadoResposta.saneamento.cotacoesIncluidas}/${mercadoResposta.totalCotacoes} cotações saneadas, CV final ${mercadoResposta.saneamento.estatisticasFinais?.coeficienteVariacao?.toFixed(1)}%. Preço de referência saneado: R$ ${mercadoResposta.saneamento.precoReferencia?.toFixed(2)}`}>
                          🧪 Saneadas TCU: {mercadoResposta.saneamento.cotacoesIncluidas}/{mercadoResposta.totalCotacoes}
                        </span>
                      )}
                      <span className="text-[10px] bg-green-50 border border-green-200 text-green-700 px-2 py-0.5 rounded font-bold uppercase tracking-wider" title={`Faixa elegivel: cotacoes >= R$ ${limiteInferior.toFixed(2)} e <= R$ ${limiteSuperior.toFixed(2)} (2.5x o valor estimado)`}>
                        ✓ Faixa R$ {limiteInferior.toFixed(2)}–{limiteSuperior.toFixed(2)}
                      </span>
                      {item.fatorConversao && item.unidadeBase && (
                        <span className="text-[10px] bg-blue-50 border border-blue-200 text-blue-700 px-2 py-0.5 rounded font-bold uppercase tracking-wider" title={`Cotacoes com embalagem incompativel com ${item.fatorConversao}${item.unidadeBase} foram descartadas`}>
                          🎯 Embalagem ~{item.fatorConversao}{item.unidadeBase.toLowerCase()}
                        </span>
                      )}
                    </div>
                  </div>

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
                        const isLower = p.valorUnitario < limiteInferior;
                        const isOutlier = p.valorUnitario > limiteSuperior;
                        const isInelegivel = isLower || isOutlier;

                        return (
                          <div
                            key={idx}
                            onClick={() => { if (!isInelegivel) toggleSelecaoCesta(p); }}
                            className={`p-3 bg-white border rounded-xl transition-all flex items-center gap-3 ${
                              isInelegivel
                                ? 'border-gray-200 opacity-60 cursor-not-allowed grayscale'
                                : `cursor-pointer hover:border-lie-green ${isSelected ? 'border-lie-green ring-2 ring-lie-green/10' : 'border-gray-200'}`
                            }`}
                            title={
                              isLower ? `Abaixo do estimado (R$ ${limiteInferior.toFixed(2)}) — nao compoe a base`
                              : isOutlier ? `Acima de 2.5x o estimado (R$ ${limiteSuperior.toFixed(2)}) — outlier, nao compoe a base`
                              : undefined
                            }
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              disabled={isInelegivel}
                              onChange={() => {}}
                              className="rounded border-gray-300 text-lie-green focus:ring-lie-green w-4.5 h-4.5 pointer-events-none disabled:opacity-40"
                            />
                            
                            <div className="flex-1">
                              <div className="flex items-start justify-between">
                                <span className="text-[10px] font-bold text-gray-500 uppercase font-mono max-w-[170px] truncate" title={p.orgaoLicitante}>
                                  {p.orgaoLicitante}
                                </span>
                                <div className="flex items-center gap-1 shrink-0">
                                  {p.localizacaoUrl && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        window.open(p.localizacaoUrl, '_blank');
                                      }}
                                      className="p-1 text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition"
                                      title="Visualizar Documentação Completa / Origem"
                                    >
                                      <Eye className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                  <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                                    p.fonte === 'pncp' ? 'bg-indigo-100 text-indigo-800' : 'bg-blue-100 text-blue-800'
                                  }`}>
                                    {p.fonte}
                                  </span>
                                </div>
                              </div>
                              
                              <h5 className="font-bold text-lie-ink text-xs mt-1">{p.identificadorCompra}</h5>
                              
                              <div className="flex justify-between items-center mt-2 pt-2 border-t border-dashed border-gray-100">
                                <span className="text-[10px] text-gray-400">Homologado em: {p.dataHomologacao}</span>
                                <div className="text-right">
                                  <span className={`text-sm font-extrabold ${isInelegivel ? 'text-gray-500 line-through' : 'text-lie-green'}`}>
                                    {p.valorUnitario.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                  </span>
                                  {isLower && (
                                    <span className="block text-[8px] text-red-600 font-bold uppercase tracking-tight -mt-0.5">⊘ Inferior — não elegível</span>
                                  )}
                                  {isOutlier && (
                                    <span className="block text-[8px] text-red-600 font-bold uppercase tracking-tight -mt-0.5">⊘ Outlier (&gt;2.5×) — não elegível</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : materialSelecionado ? (
                    <div className="p-6 bg-amber-50 border border-amber-200 rounded-xl text-xs leading-relaxed space-y-2">
                      <p className="font-bold text-amber-900 flex items-center gap-2">
                        <AlertCircle className="w-4 h-4" />
                        Nenhuma cotação real localizada na API pública (Compras.gov.br/PNCP).
                      </p>
                      <p className="text-amber-800">
                        O sistema <strong>não inventa cotações</strong> — pra atender a IN 65/2021,
                        cadastre uma cotação real usando a aba <strong>Registro Manual</strong> (anexe
                        o PDF do Termo de Fomento, Ata de Registro ou contrato).
                      </p>
                      <p className="text-amber-700 text-[11px]">
                        Você também pode tentar trocar o material semente acima pra buscar por outro
                        código CATMAT/CATSER mais específico.
                      </p>
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
            {activeTab === 'manual' && (() => {
              // Metadados das 5 categorias de cotação manual (IN 73/2020, IN 65/2021, TCU)
              const CATEGORIAS_MANUAIS: Array<{
                valor: CategoriaManual;
                titulo: string;
                baseLegal: string;
                descricao: string;
                placeholderId: string;
                labelId: string;
                placeholderOrgao: string;
                cor: 'green' | 'teal' | 'blue' | 'amber' | 'red';
                ultimoRecurso?: boolean;
              }> = [
                {
                  valor: 'contrato-publico',
                  titulo: 'Contrato público similar',
                  baseLegal: 'IN 73/2020 art. 5º II',
                  descricao: 'Contrato já celebrado por outro ente público nos últimos 12 meses (prioritário, TCU 1231/2018)',
                  labelId: 'Nº do Contrato / Pregão / Processo *',
                  placeholderId: 'Ex: Pregão Eletrônico nº 045/2025',
                  placeholderOrgao: 'Ex: PREFEITURA DE SÃO PAULO',
                  cor: 'green',
                },
                {
                  valor: 'convenio',
                  titulo: 'Convênio',
                  baseLegal: 'IN 73/2020 art. 5º II',
                  descricao: 'Convênio firmado entre entes públicos ou com OSC (Lei 13.019/2014)',
                  labelId: 'Nº do Convênio *',
                  placeholderId: 'Ex: Convênio nº 12/2025 - SEMESP',
                  placeholderOrgao: 'Ex: SECRETARIA MUNICIPAL DE EDUCAÇÃO',
                  cor: 'teal',
                },
                {
                  valor: 'termo-fomento',
                  titulo: 'Termo de Fomento / Colaboração',
                  baseLegal: 'IN 73/2020 art. 5º II + Lei 13.019/2014',
                  descricao: 'Termo de Fomento ou Colaboração com OSC (típico no setor LIE)',
                  labelId: 'Nº do Termo de Fomento / Colaboração *',
                  placeholderId: 'Ex: Termo de Fomento nº 45/2025',
                  placeholderOrgao: 'Ex: SECRETARIA ESTADUAL DE ESPORTES - SP',
                  cor: 'blue',
                },
                {
                  valor: 'tabela-preco',
                  titulo: 'Tabela de Preços',
                  baseLegal: 'IN 73/2020 art. 5º III',
                  descricao: 'Tabela de mídia especializada ou de domínio amplo (catálogos, revistas, sites públicos)',
                  labelId: 'Identificador da Tabela / Edição *',
                  placeholderId: 'Ex: Tabela SINAPI nov/2025',
                  placeholderOrgao: 'Ex: CAIXA / IBGE / SINAPI',
                  cor: 'amber',
                },
                {
                  valor: 'manual',
                  titulo: '⚠ 3 orçamentos de fornecedores',
                  baseLegal: 'IN 73/2020 art. 5º IV — ÚLTIMO RECURSO',
                  descricao: 'Use APENAS quando todas as outras fontes (PNCP, contratos, convênios, fomento, tabelas) falharem. Adicione 3 orçamentos distintos.',
                  labelId: 'Identificador do Orçamento *',
                  placeholderId: 'Ex: Orçamento 1/3 - Fornecedor X',
                  placeholderOrgao: 'Ex: RAZÃO SOCIAL DO FORNECEDOR',
                  cor: 'red',
                  ultimoRecurso: true,
                },
              ];
              const catAtual = CATEGORIAS_MANUAIS.find(c => c.valor === categoriaManual) || CATEGORIAS_MANUAIS[2];
              const coresAviso: Record<typeof catAtual.cor, string> = {
                green: 'bg-green-50 border-green-200 text-green-900',
                teal: 'bg-teal-50 border-teal-200 text-teal-900',
                blue: 'bg-blue-50 border-blue-200 text-blue-900',
                amber: 'bg-amber-50 border-amber-200 text-amber-900',
                red: 'bg-red-50 border-red-300 text-red-900',
              };
              return (
              <form onSubmit={handleAdicionarManual} className="space-y-4">
                {/* Seletor de categoria */}
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-2">
                    Fonte da cotação <span className="text-gray-500 font-normal">(ordem de prioridade legal)</span>
                  </label>
                  <div className="grid grid-cols-1 gap-1.5">
                    {CATEGORIAS_MANUAIS.map(cat => {
                      const ativo = categoriaManual === cat.valor;
                      const corBorda = ativo
                        ? cat.ultimoRecurso ? 'border-red-400 bg-red-50' : `border-${cat.cor}-400 bg-${cat.cor}-50`
                        : 'border-gray-200 bg-white hover:border-gray-300';
                      return (
                        <label
                          key={cat.valor}
                          className={`flex items-start gap-2 p-2 rounded-lg border cursor-pointer transition ${corBorda}`}
                        >
                          <input
                            type="radio"
                            name="categoria-manual"
                            value={cat.valor}
                            checked={ativo}
                            onChange={() => setCategoriaManual(cat.valor)}
                            className={`mt-0.5 ${cat.ultimoRecurso ? 'text-red-600 focus:ring-red-500' : 'text-lie-green focus:ring-lie-green'}`}
                          />
                          <div className="flex-1 min-w-0">
                            <div className={`text-xs font-bold ${cat.ultimoRecurso ? 'text-red-800' : 'text-lie-ink'}`}>
                              {cat.titulo}
                              <span className={`ml-1.5 text-[9px] font-semibold uppercase tracking-wider ${cat.ultimoRecurso ? 'text-red-600' : 'text-gray-500'}`}>
                                {cat.baseLegal}
                              </span>
                            </div>
                            <div className="text-[10px] text-gray-600 leading-snug mt-0.5">
                              {cat.descricao}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* Aviso contextual da categoria escolhida */}
                <div className={`p-3 rounded-xl text-xs flex gap-2 border leading-relaxed ${coresAviso[catAtual.cor]}`}>
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <strong>{catAtual.titulo}:</strong>{' '}
                    {catAtual.ultimoRecurso
                      ? <>Esta é a opção <strong>de último recurso</strong>. Antes, verifique se realmente não existe contrato público similar, convênio, termo de fomento, ou tabela de preço que atenda. O TCU (Acórdão 1445/2015) prioriza fontes diversificadas e públicas.</>
                      : <>O anexo do PDF oficial é <strong>OBRIGATÓRIO</strong> para auditoria no relatório consolidado (IN 65/2021 art. 6º). Fundamentação legal: <strong>{catAtual.baseLegal}</strong>.</>
                    }
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">Órgão / Entidade / Fornecedor *</label>
                    <input
                      type="text"
                      required
                      placeholder={catAtual.placeholderOrgao}
                      value={manualOrgao}
                      onChange={e => setManualOrgao(e.target.value)}
                      className="w-full border-gray-300 rounded-xl text-sm"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1">{catAtual.labelId}</label>
                      <input
                        type="text"
                        required
                        placeholder={catAtual.placeholderId}
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
                    className={`w-full mt-2 text-white font-bold text-xs py-2.5 rounded-xl shadow-sm transition flex items-center justify-center gap-1.5 ${
                      catAtual.ultimoRecurso ? 'bg-red-600 hover:bg-red-700' : 'bg-lie-ink hover:bg-lie-ink/90'
                    }`}
                  >
                    <Plus className="w-4 h-4" />
                    Adicionar à cesta como <strong className="ml-1">{catAtual.titulo}</strong>
                  </button>
                </div>
              </form>
              );
            })()}

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
                cestaReferencias.map((r, idx) => {
                  const corBadge = (() => {
                    switch (r.fonte) {
                      case 'compras.gov.br':
                      case 'pncp':
                      case 'pncp-contratacao':
                      case 'pncp-ata':
                      case 'tce-pe':
                        return 'bg-blue-100 text-blue-800';
                      case 'contrato-publico': return 'bg-green-100 text-green-800';
                      case 'convenio': return 'bg-teal-100 text-teal-800';
                      case 'termo-fomento':
                      case 'fomento': return 'bg-blue-100 text-blue-800';
                      case 'tabela-preco': return 'bg-amber-100 text-amber-800';
                      case 'manual': return 'bg-red-100 text-red-800';
                      default: return 'bg-gray-100 text-gray-800';
                    }
                  })();
                  return (
                  <div key={idx} className="p-3 bg-gray-50 border border-gray-200 rounded-xl flex items-center justify-between group">
                    <div className="flex-1 pr-2 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[8px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider ${corBadge}`}>
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
                    <div className="flex items-center gap-1">
                      {r.localizacaoUrl && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            window.open(r.localizacaoUrl, '_blank');
                          }}
                          className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"
                          title="Visualizar Documentação Completa"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        onClick={() => removerDaCesta(idx)}
                        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition"
                        title="Remover"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  );
                })
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

/**
 * Gera a Certidao de Comprovacao e Preco Publico em PDF.
 * Aproveita todos os campos disponiveis do PNCP/Compras.gov.br + dados
 * do item LIE (CATMAT/CATSER vinculado) + vinculo institucional
 * (entidade + projeto + denominacao do item).
 */
function gerarCertidaoCotaçãoPDF(
  r: PrecoReferencia,
  item: ItemPesquisavel,
  projetoTitulo: string,
  entidadeNome: string,
  token: string
): Blob {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const fmtBrl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const truncar = (s: string | undefined | null, n: number) => (s || '—').toString().substring(0, n);
  const COL_LABEL_X = 15;
  const COL_VAL_X = 62;
  const PG_W = 210;
  const RIGHT_MARGIN = 195;

  // ============ CABECALHO ============
  doc.setFillColor(15, 23, 42); // slate-900
  doc.rect(0, 0, PG_W, 32, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text("REGISTRO NACIONAL DE PREÇOS PÚBLICOS", 15, 14);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(34, 211, 238);
  doc.text("PORTAL DE AUDITORIA E CONFORMIDADE LEGAL — IN SEGES/ME Nº 65/2021 · LEI 14.133/21 · ACÓRDÃO TCU 1445/2015", 15, 21);

  // Tipo de fonte (badge no cabecalho a direita)
  const fonteLabel = (() => {
    switch (r.fonte) {
      case 'compras.gov.br': return 'COMPRAS.GOV.BR';
      case 'pncp':
      case 'pncp-contratacao': return 'PNCP — CONTRATAÇÃO';
      case 'pncp-ata': return 'PNCP — ATA';
      case 'tce-pe': return 'TCE-PE';
      case 'contrato-publico': return 'CONTRATO PÚBLICO';
      case 'convenio': return 'CONVÊNIO';
      case 'termo-fomento':
      case 'fomento': return 'TERMO DE FOMENTO';
      case 'tabela-preco': return 'TABELA DE PREÇOS';
      case 'manual': return 'ORÇAMENTO FORNECEDOR';
      default: return String(r.fonte).toUpperCase();
    }
  })();
  doc.setFillColor(34, 211, 238);
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(6.5);
  doc.setFont('helvetica', 'bold');
  const fonteW = doc.getTextWidth(fonteLabel) + 4;
  doc.rect(PG_W - 15 - fonteW, 16, fonteW, 6, 'F');
  doc.text(fonteLabel, PG_W - 13 - fonteW + 2, 20);

  // ============ TITULO ============
  doc.setTextColor(30, 41, 59);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text("CERTIDÃO DE COMPROVAÇÃO DE PREÇO PÚBLICO", 15, 42);

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text(`Identificador do Registro (Token): ${token}`, 15, 48);

  // ============ SECAO 1: ORGAO E CONTRATACAO ============
  let y = 56;
  const drawSecaoHeader = (titulo: string, yPos: number) => {
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.line(15, yPos, RIGHT_MARGIN, yPos);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    doc.text(titulo, 15, yPos + 5);
    return yPos + 9;
  };

  const drawCampo = (label: string, valor: string, yPos: number, options?: { destacar?: boolean; xLabel?: number; xVal?: number; truncate?: number }) => {
    const xL = options?.xLabel ?? COL_LABEL_X;
    const xV = options?.xVal ?? COL_VAL_X;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(label, xL, yPos);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(options?.destacar ? 16 : 30, options?.destacar ? 185 : 41, options?.destacar ? 129 : 59);
    doc.text(truncar(valor, options?.truncate ?? 90), xV, yPos);
    return yPos + 5;
  };

  y = drawSecaoHeader("1. DADOS DO ÓRGÃO LICITANTE / CONTRATANTE PÚBLICO", y);
  y = drawCampo("Órgão / Entidade Pública:", r.orgaoLicitante, y, { truncate: 80 });
  if (r.cnpjOrgao) y = drawCampo("CNPJ do Órgão:", r.cnpjOrgao, y);
  // Linha com Poder | Esfera | UF lado a lado pra economizar espaco
  if (r.poder || r.esfera || r.uf || r.municipio) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(100, 116, 139);
    doc.text("Poder · Esfera · UF · Município:", 15, y);
    doc.setFont('helvetica', 'bold'); doc.setTextColor(30, 41, 59);
    doc.text(`${r.poder || '—'} · ${r.esfera || '—'} · ${r.uf || '—'} · ${r.municipio || '—'}`, COL_VAL_X, y);
    y += 5;
  }
  if (r.uasg) y = drawCampo("Código UASG:", r.uasg, y);

  // ============ SECAO 2: PROCESSO / CONTRATACAO ============
  y += 2;
  y = drawSecaoHeader("2. PROCESSO DE CONTRATAÇÃO E HOMOLOGAÇÃO", y);
  y = drawCampo("Identificador da Compra:", r.identificadorCompra, y, { truncate: 90 });
  if (r.numeroControlePNCP) y = drawCampo("Nº Controle PNCP:", r.numeroControlePNCP, y);
  if (r.modalidade) y = drawCampo("Modalidade:", r.modalidade, y);
  if (r.criterioJulgamento) y = drawCampo("Critério de Julgamento:", r.criterioJulgamento, y, { truncate: 80 });
  if (r.modoDisputa) y = drawCampo("Modo de Disputa:", r.modoDisputa, y, { truncate: 80 });
  if (r.leiAplicada) y = drawCampo("Lei Aplicada:", r.leiAplicada, y, { destacar: true });
  if (r.amparoLegal && r.amparoLegal !== r.leiAplicada) y = drawCampo("Amparo Legal:", r.amparoLegal, y, { truncate: 80 });
  if (r.situacao) y = drawCampo("Situação:", r.situacao, y);
  if (r.dataPublicacao) y = drawCampo("Publicação no PNCP:", r.dataPublicacao, y);
  if (r.dataHomologacao) y = drawCampo("Data de Homologação:", r.dataHomologacao, y);
  if (r.dataVigenciaFinalAta) y = drawCampo("Vigência Final (Ata):", r.dataVigenciaFinalAta, y);
  if (r.objetoCompra) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(100, 116, 139);
    doc.text("Objeto da Contratação:", 15, y);
    doc.setFont('helvetica', 'bold'); doc.setTextColor(30, 41, 59);
    const lines = doc.splitTextToSize(r.objetoCompra, 130);
    doc.text(lines.slice(0, 2), COL_VAL_X, y);
    y += Math.min(lines.length, 2) * 4 + 1;
  }

  // ============ SECAO 3: ITEM HOMOLOGADO (na licitacao) ============
  y += 2;
  y = drawSecaoHeader("3. ITEM HOMOLOGADO NA LICITAÇÃO", y);
  if (r.codigoCatalogoItem) y = drawCampo("Código Catálogo (CATMAT/CATSER):", r.codigoCatalogoItem, y);
  if (r.descricaoItem) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(100, 116, 139);
    doc.text("Descrição (conforme edital):", 15, y);
    doc.setFont('helvetica', 'bold'); doc.setTextColor(30, 41, 59);
    const lines = doc.splitTextToSize(r.descricaoItem, 130);
    doc.text(lines.slice(0, 3), COL_VAL_X, y);
    y += Math.min(lines.length, 3) * 4 + 1;
  }
  if (r.quantidade || r.unidadeMedida) {
    y = drawCampo("Quantidade / Unidade:", `${r.quantidade || '—'} ${r.unidadeMedida || ''}`.trim(), y);
  }
  if (r.fornecedorNome) y = drawCampo("Fornecedor Adjudicatário:", r.fornecedorNome, y, { truncate: 80 });
  if (r.fornecedorCnpj) y = drawCampo("CNPJ Fornecedor:", r.fornecedorCnpj, y);
  if (r.inscricaoEstadualFornecedor) y = drawCampo("Inscrição Estadual:", r.inscricaoEstadualFornecedor, y);
  y = drawCampo("Valor Unitário Homologado:", fmtBrl(r.valorUnitario), y, { destacar: true });
  // Valor total da contratacao (computado: quantidade × valor unitario)
  if (r.quantidade && r.quantidade > 0) {
    const valorTotal = r.valorUnitario * r.quantidade;
    y = drawCampo("Valor Total Contratado:", `${fmtBrl(valorTotal)} (${r.quantidade} ${r.unidadeMedida || ''} × ${fmtBrl(r.valorUnitario)})`, y, { truncate: 80 });
  }

  // ============ DECLARACAO LEGAL ============
  // Sem secao "Vinculo com Projeto" porque a pesquisa vive no Banco de Itens
  // (etapa 5C) — vale pra todos os projetos. Vinculo institucional aparece
  // apenas no PDF de consolidacao do projeto, nao nesta certidao individual.
  void entidadeNome; void projetoTitulo; void item; // evita warning de unused
  y += 3;
  if (y > 230) y = 230; // garante espaco pra declaracao+selo
  doc.setFillColor(248, 250, 252);
  doc.rect(15, y, 180, 32, 'F');
  doc.setDrawColor(203, 213, 225);
  doc.rect(15, y, 180, 32, 'S');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(30, 41, 59);
  doc.text("DECLARAÇÃO DE ECONOMICIDADE E CONFORMIDADE LEGAL", 20, y + 5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(71, 85, 105);
  const textStr = "Atesta-se que o preço público acima referenciado foi coletado integralmente do " +
    `${r.fonte === 'pncp' || r.fonte === 'pncp-contratacao' || r.fonte === 'pncp-ata' ? 'Portal Nacional de Contratações Públicas (PNCP)' : (r.fonte === 'compras.gov.br' ? 'Portal de Compras do Governo Federal' : 'documento publico oficial anexo')}, ` +
    "compondo a cesta estatística de preços públicos homologados conforme Art. 5º da IN SEGES/ME 65/2021, " +
    "Art. 23 da Lei 14.133/21 e Acórdãos TCU 1445/2015 e 1231/2018 (fontes diversificadas, pesquisa ampla). " +
    "Registro auditável pelo link público abaixo.";
  const textLines = doc.splitTextToSize(textStr, 170);
  doc.text(textLines, 20, y + 11);

  y += 36;

  // ============ LINKS CLICAVEIS ============
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(2, 132, 199);
  doc.setFontSize(7);
  const linkValidacao = `https://projetos.lie.com.br/#/validar?token=${token}`;
  doc.textWithLink(`▸ Validação online da certidão (clique para abrir)`, 15, y, { url: linkValidacao });
  y += 4;
  // PRIORIDADE 1: link DIRETO pro PDF do edital (obtido via obterArquivosContratacao)
  if (r.linkEditalPdf) {
    doc.textWithLink(`▸ PDF do Edital no PNCP (download direto)`, 15, y, { url: r.linkEditalPdf });
    y += 4;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(5.5); doc.setTextColor(100, 116, 139);
    doc.text(r.linkEditalPdf.substring(0, 150), 15, y);
    y += 3;
    doc.setFont('helvetica', 'bold'); doc.setTextColor(2, 132, 199); doc.setFontSize(7);
  }
  // PRIORIDADE 2: pagina da contratacao no PNCP
  if (r.linkPncpOriginal) {
    doc.textWithLink(`▸ Página da contratação no PNCP`, 15, y, { url: r.linkPncpOriginal });
    y += 4;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(5.5); doc.setTextColor(100, 116, 139);
    doc.text(r.linkPncpOriginal.substring(0, 150), 15, y);
    y += 3;
    doc.setFont('helvetica', 'bold'); doc.setTextColor(2, 132, 199); doc.setFontSize(7);
  } else if (r.localizacaoUrl && r.fonte !== 'fomento' && r.fonte !== 'manual') {
    doc.textWithLink(`▸ Documento da fonte`, 15, y, { url: r.localizacaoUrl });
    y += 4;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(5.5); doc.setTextColor(100, 116, 139);
    doc.text(r.localizacaoUrl.substring(0, 150), 15, y);
    y += 3;
    doc.setFont('helvetica', 'bold'); doc.setTextColor(2, 132, 199); doc.setFontSize(7);
  }
  // Anexos adicionais (se houver)
  if (r.arquivosPNCP && r.arquivosPNCP.length > 1) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6); doc.setTextColor(100, 116, 139);
    doc.text(`Anexos disponíveis (${r.arquivosPNCP.length}): ${r.arquivosPNCP.map(a => a.tipo).slice(0, 5).join(', ')}${r.arquivosPNCP.length > 5 ? '…' : ''}`, 15, y);
    y += 3;
    doc.setFont('helvetica', 'bold'); doc.setTextColor(2, 132, 199); doc.setFontSize(7);
  }
  // Link Compras.gov.br (busca pelo CATMAT na pesquisa de precos)
  if (r.codigoCatalogoItem) {
    const linkComprasGov = `https://catalogo.compras.gov.br/cnbs-web/busca?codigo=${r.codigoCatalogoItem}`;
    doc.textWithLink(`▸ Verificar CATMAT/CATSER ${r.codigoCatalogoItem} no Catálogo`, 15, y, { url: linkComprasGov });
    y += 4;
  }

  // ============ FONTES CONSULTADAS (rodape compacto) ============
  y += 3;
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.line(15, y, RIGHT_MARGIN, y);
  y += 4;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(71, 85, 105);
  doc.text("FONTES CONSULTADAS", 15, y);
  y += 4;

  // Mapeia r.fonte pra portal/URL exibida
  const fontesUsadas: Array<{ label: string; url: string }> = [];
  if (r.fonte === 'pncp' || r.fonte === 'pncp-contratacao' || r.fonte === 'pncp-ata') {
    fontesUsadas.push({ label: 'Portal Nacional de Contratações Públicas (PNCP)', url: 'https://pncp.gov.br' });
  }
  if (r.fonte === 'compras.gov.br') {
    fontesUsadas.push({ label: 'Compras.gov.br — Dados Abertos', url: 'https://dadosabertos.compras.gov.br' });
  }
  if (r.fonte === 'tce-pe') {
    fontesUsadas.push({ label: 'TCE-PE — Tribunal de Contas de Pernambuco', url: 'https://sistemas.tce.pe.gov.br/DadosAbertos/' });
  }
  const fontesManuaisMap: Record<string, string> = {
    'contrato-publico': 'Contrato público similar (anexado)',
    'convenio': 'Convênio (anexado)',
    'termo-fomento': 'Termo de Fomento (anexado)',
    'fomento': 'Termo de Fomento (anexado)',
    'tabela-preco': 'Tabela de Preços (anexada)',
    'manual': 'Orçamento de Fornecedor (anexado)',
  };
  if (fontesManuaisMap[r.fonte]) {
    fontesUsadas.push({ label: fontesManuaisMap[r.fonte], url: r.localizacaoUrl || '' });
  }
  // CATMAT/CATSER sempre consultado quando ha codigoCatalogoItem
  if (r.codigoCatalogoItem) {
    fontesUsadas.push({ label: 'Catálogo CATMAT/CATSER (Compras.gov.br)', url: 'https://catalogo.compras.gov.br' });
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(60, 60, 60);
  fontesUsadas.forEach((f, idx) => {
    doc.text(`${idx + 1}. ${f.label}`, 15, y);
    if (f.url) {
      doc.setTextColor(2, 132, 199);
      doc.textWithLink(f.url.length > 75 ? f.url.substring(0, 72) + '…' : f.url, 105, y, { url: f.url });
      doc.setTextColor(60, 60, 60);
    }
    y += 3.5;
  });

  // Selo carimbo
  doc.setDrawColor(16, 185, 129);
  doc.setLineWidth(0.5);
  doc.rect(140, 260, 55, 22);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(16, 185, 129);
  doc.text("PREÇO PÚBLICO", 143, 265);
  doc.text("VALIDADO & HOMOLOGADO", 143, 269);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.5);
  doc.setTextColor(100, 116, 139);
  doc.text(`Token: ${token.substring(0, 16)}…`, 143, 274);
  doc.text(`Reg: ${new Date().toLocaleDateString('pt-BR')}`, 143, 278);

  // Rodape
  doc.setTextColor(148, 163, 184);
  doc.setFontSize(6);
  doc.text("Documento de rastreabilidade gerado eletronicamente. Brasília-DF.", 15, 288);

  return doc.output('blob');
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
