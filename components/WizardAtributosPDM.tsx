// Wizard de atributos PDM - Fase 3 redesign 2026-05-29
//
// Apresenta uma pergunta por caracteristica obrigatoria do PDM vinculado ao item,
// permitindo escolher o valor entre os enumerados oficialmente pelo SERPRO CNBS.
// Inclui step extra de EMBALAGEM (unidade fornecimento + capacidade + sigla) que
// puxa opcoes REAIS do mercado publico via coletarMercadoItem.

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, CheckCircle2, Loader2, X, AlertTriangle, Database, Package } from 'lucide-react';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { getPdmFromCache, getServicoFromCache, sincronizarCatalogoCNBS, type PdmCache, type ServicoCache } from '../lib/catalogoPdmsApi';
import { coletarMercadoItem, type MercadoResposta, type EstatisticasPorUnidade } from '../lib/mercadoApi';
import type { ItemMaster } from '../types';

interface WizardAtributosPDMProps {
  item: ItemMaster;
  onClose: () => void;
  onComplete: () => void;
}

type RespostasMap = Record<string, { codigoValor: string; nomeValor: string; siglaUM?: string | null }>;

type EmbalagemEscolhida = {
  unidadeFornecimento: string;      // "COPO"
  siglaFornecimento: string;        // "COPO" (sigla curta)
  capacidade: number;               // 200
  siglaCapacidade: string;          // "ML"
};

export default function WizardAtributosPDM({ item, onClose, onComplete }: WizardAtributosPDMProps) {
  const [pdm, setPdm] = useState<PdmCache | null>(null);
  const [servico, setServico] = useState<ServicoCache | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [carregandoMsg, setCarregandoMsg] = useState('Buscando dados do catálogo no cache local…');
  const [erro, setErro] = useState<string | null>(null);
  const [etapa, setEtapa] = useState(0);
  const [respostas, setRespostas] = useState<RespostasMap>({});
  const [salvando, setSalvando] = useState(false);

  // Embalagem (step extra apos as caracteristicas)
  const [mercadoData, setMercadoData] = useState<MercadoResposta | null>(null);
  const [carregandoMercado, setCarregandoMercado] = useState(true);
  const [embalagem, setEmbalagem] = useState<EmbalagemEscolhida | null>(null);
  const [embalagemCustomizada, setEmbalagemCustomizada] = useState({
    unidade: '', siglaFornecimento: '', capacidade: 0, siglaCapacidade: 'ML',
  });
  const [usarCustomizada, setUsarCustomizada] = useState(false);

  const tipoCatalogo: 'material' | 'servico' = (item.tipoCatmat || 'material') as 'material' | 'servico';

  useEffect(() => {
    const carregarCatalogo = async () => {
      if (!item.codigoCatmat) {
        setErro('Item sem CATMAT/CATSER vinculado. Vincule um código antes de usar o wizard.');
        setCarregando(false);
        return;
      }

      if (tipoCatalogo === 'servico') {
        const cached = await getServicoFromCache(item.codigoCatmat);
        if (cached) {
          setServico(cached);
          setCarregando(false);
          return;
        }
        setCarregandoMsg('Serviço não está no cache local. Baixando do SERPRO CNBS…');
        const sync = await sincronizarCatalogoCNBS({ codigosCatser: [item.codigoCatmat] });
        if (sync && sync.servicosAtualizados > 0) {
          const novo = await getServicoFromCache(item.codigoCatmat);
          setServico(novo);
          setCarregando(false);
        } else {
          setErro('Não consegui carregar o catálogo deste serviço. Tente sincronizar pelo botão "Sincronizar Catálogo" e abra o wizard de novo.');
          setCarregando(false);
        }
        return;
      }

      setCarregandoMsg('Buscando características do PDM no cache…');
      const syncResp = await sincronizarCatalogoCNBS({ codigosCatmat: [item.codigoCatmat] });
      if (!syncResp || syncResp.pdmsAtualizados === 0) {
        setErro('Não consegui resolver o PDM deste item. Tente "Sincronizar Catálogo" no header e tente novamente.');
        setCarregando(false);
        return;
      }

      const { findPdmByItem } = await import('../lib/catalogoPdmsApi');
      const pdmEncontrado = await findPdmByItem(item.codigoCatmat);
      if (!pdmEncontrado) {
        setErro('PDM encontrado no SERPRO mas não consegui localizar no cache local. Tente sincronizar novamente.');
        setCarregando(false);
        return;
      }
      setPdm(pdmEncontrado);

      // Pre-popula respostas
      if (item.atributosWizard && item.atributosWizard.length > 0) {
        const respPre: RespostasMap = {};
        for (const a of item.atributosWizard) {
          respPre[a.codigoCaracteristica] = {
            codigoValor: a.codigoValorCaracteristica,
            nomeValor: a.nomeValorCaracteristica,
            siglaUM: a.siglaUnidadeMedida,
          };
        }
        setRespostas(respPre);
      } else {
        const itemVinculado = pdmEncontrado.itensVinculados.find(iv => iv.codigoItem === item.codigoCatmat);
        if (itemVinculado) {
          const respPre: RespostasMap = {};
          for (const a of itemVinculado.atributos) {
            respPre[a.codigo] = { codigoValor: a.codigoValor, nomeValor: a.nomeValor };
          }
          setRespostas(respPre);
        }
      }

      // Pre-popula embalagem se item ja tem
      if (item.fatorConversao && item.fatorConversao > 0 && item.unidadeBase) {
        setEmbalagem({
          unidadeFornecimento: String(item.unidade || '').toUpperCase(),
          siglaFornecimento: item.siglaUnidadeFornecimento || String(item.unidade || '').toUpperCase().slice(0, 5),
          capacidade: item.fatorConversao,
          siglaCapacidade: item.unidadeBase,
        });
      }

      setCarregando(false);
    };
    carregarCatalogo();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.codigoCatmat]);

  // Em paralelo, busca mercado pra extrair embalagens reais
  useEffect(() => {
    if (!item.codigoCatmat || tipoCatalogo === 'servico') {
      setCarregandoMercado(false);
      return;
    }
    coletarMercadoItem(item.codigoCatmat, 'material')
      .then(data => {
        setMercadoData(data);
        setCarregandoMercado(false);
      })
      .catch(() => setCarregandoMercado(false));
  }, [item.codigoCatmat, tipoCatalogo]);

  // Caracteristicas obrigatorias do PDM
  const caracteristicasObrigatorias = (pdm?.caracteristicas || [])
    .filter(c => c.obrigatoria && c.valores.some(v => v.ativo))
    .sort((a, b) => a.numero - b.numero);

  // Material: N caracteristicas + 1 step de embalagem = N+1 steps
  // Servico: 1 step de confirmacao
  const totalSteps = tipoCatalogo === 'servico'
    ? 1
    : caracteristicasObrigatorias.length + 1;
  const isUltimoStep = etapa === totalSteps - 1;
  const isStepEmbalagem = tipoCatalogo === 'material' && etapa === caracteristicasObrigatorias.length;
  const etapaAtual = caracteristicasObrigatorias[etapa];
  const respondida = isStepEmbalagem
    ? !!embalagem
    : (etapaAtual ? !!respostas[etapaAtual.codigo] : false);

  const todasCaracteristicasRespondidas = caracteristicasObrigatorias.every(c => respostas[c.codigo]);
  const podeFinalizarMaterial = todasCaracteristicasRespondidas && !!embalagem;

  // Embalagens reais agregadas do mercado
  const embalagensMercado: EstatisticasPorUnidade[] = (mercadoData?.porUnidade || [])
    .filter(u => (u.totalCotacoes || 0) > 0)
    .sort((a, b) => (b.totalCotacoes || 0) - (a.totalCotacoes || 0));

  const frequenciaValor = (codigoCarac: string, codigoVal: string): number => {
    if (!pdm) return 0;
    const total = pdm.itensVinculados.length;
    if (total === 0) return 0;
    const matches = pdm.itensVinculados.filter(iv =>
      iv.atributos.some(a => a.codigo === codigoCarac && a.codigoValor === codigoVal)
    ).length;
    return Math.round((matches / total) * 100);
  };

  const salvarItem = async () => {
    setSalvando(true);
    try {
      if (tipoCatalogo === 'servico') {
        await setDoc(doc(db, 'items', item.id), {
          atributosWizard: [],
          atributosWizardCompletoEm: serverTimestamp(),
          precisaCompletarWizard: false,
        }, { merge: true });
      } else {
        const atributos = caracteristicasObrigatorias.map(c => {
          const r = respostas[c.codigo];
          return {
            codigoCaracteristica: c.codigo,
            codigoValorCaracteristica: r.codigoValor,
            nomeCaracteristica: c.nome,
            nomeValorCaracteristica: r.nomeValor,
            siglaUnidadeMedida: r.siglaUM || null,
          };
        });
        // Monta embalagem descricao humana legivel
        const embDesc = embalagem
          ? `${embalagem.unidadeFornecimento.toLowerCase()} ${embalagem.capacidade}${embalagem.siglaCapacidade.toLowerCase()}`
          : (item.embalagemDescricao || '');
        await setDoc(doc(db, 'items', item.id), {
          atributosWizard: atributos,
          atributosWizardCompletoEm: serverTimestamp(),
          precisaCompletarWizard: false,
          // Embalagem alinhada com API federal — chave da pesquisa deterministica
          siglaUnidadeFornecimento: embalagem?.siglaFornecimento || null,
          fatorConversao: embalagem?.capacidade || null,
          unidadeBase: embalagem?.siglaCapacidade || null,
          embalagemDescricao: embDesc,
          // Atualiza unidade humana se mudou
          unidade: embalagem ? embalagem.unidadeFornecimento.toLowerCase() : item.unidade,
        }, { merge: true });
      }
      onComplete();
    } catch (e: any) {
      setErro(`Erro ao salvar: ${e?.message || e}`);
      setSalvando(false);
    }
  };

  // ====== RENDER ======
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[88vh]">
        <header className="bg-lie-ink p-4 flex items-center justify-between text-white">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 bg-purple-500 rounded-lg shrink-0">
              <Database className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <h3 className="font-bold truncate">Wizard de Atributos</h3>
              <p className="text-xs text-gray-300 truncate">{item.nome}</p>
            </div>
          </div>
          <button onClick={onClose} className="hover:bg-white/10 p-2 rounded-full transition shrink-0">
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="p-6 overflow-y-auto flex-1">
          {carregando && (
            <div className="flex flex-col items-center justify-center py-8 gap-3">
              <Loader2 className="w-8 h-8 text-purple-500 animate-spin" />
              <p className="text-sm text-gray-600">{carregandoMsg}</p>
            </div>
          )}

          {!carregando && erro && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div className="text-sm text-red-800">{erro}</div>
            </div>
          )}

          {/* CATSER */}
          {!carregando && !erro && servico && (
            <div className="space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="text-xs font-bold text-blue-700 uppercase tracking-wider mb-1">Serviço CATSER {servico.codigoServico}</div>
                <div className="text-lg font-bold text-gray-800">{servico.descricao}</div>
                <div className="text-xs text-gray-600 mt-1">Grupo: <strong>{servico.nomeGrupo}</strong></div>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
                <strong>Nota sobre serviços:</strong> CATSER não tem atributos estruturados como CATMAT.
                A pesquisa de preço de serviços usa descrição livre + filtros temporais + segmentação geográfica.
              </div>
            </div>
          )}

          {/* CATMAT — STEP DE CARACTERISTICAS */}
          {!carregando && !erro && pdm && !isStepEmbalagem && etapaAtual && (
            <div className="space-y-4">
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
                <div className="text-xs font-bold text-purple-700 uppercase tracking-wider">
                  PDM {pdm.codigoPdm} — {pdm.nomePdm}
                </div>
                <div className="text-[11px] text-purple-600 mt-0.5">
                  Etapa {etapa + 1} de {totalSteps} · {pdm.itensVinculados.length} variações catalogadas
                </div>
              </div>

              <div>
                <h4 className="text-lg font-bold text-gray-800 mb-3">
                  {etapaAtual.nome}
                  {etapaAtual.obrigatoria && <span className="text-red-500 ml-1">*</span>}
                </h4>
                <div className="space-y-2">
                  {etapaAtual.valores.filter(v => v.ativo).map(v => {
                    const freq = frequenciaValor(etapaAtual.codigo, v.codigo);
                    const sel = respostas[etapaAtual.codigo]?.codigoValor === v.codigo;
                    return (
                      <button
                        key={v.codigo}
                        onClick={() => setRespostas(prev => ({
                          ...prev,
                          [etapaAtual.codigo]: { codigoValor: v.codigo, nomeValor: v.nome, siglaUM: v.siglaUnidadeMedida },
                        }))}
                        className={`w-full text-left p-3 rounded-lg border-2 transition flex items-center justify-between gap-3 ${
                          sel ? 'bg-purple-50 border-purple-500 ring-2 ring-purple-200' : 'bg-white border-gray-200 hover:border-purple-300 hover:bg-purple-50/50'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-4 h-4 rounded-full border-2 shrink-0 ${sel ? 'border-purple-500 bg-purple-500' : 'border-gray-300'}`}>
                            {sel && <div className="w-1.5 h-1.5 bg-white rounded-full m-auto mt-0.5" />}
                          </div>
                          <div>
                            <div className="font-semibold text-gray-800">{v.nome}</div>
                            {v.siglaUnidadeMedida && <div className="text-[10px] text-gray-500">Unidade: {v.siglaUnidadeMedida}</div>}
                          </div>
                        </div>
                        {freq > 0 && <span className="text-[10px] text-gray-500 italic shrink-0">{freq}% das variações</span>}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="text-[11px] text-gray-500 italic">
                ⓘ "% das variações" mostra a frequência desse valor nos {pdm.itensVinculados.length} itens catalogados do PDM.
              </div>
            </div>
          )}

          {/* CATMAT — STEP DE EMBALAGEM (após características) */}
          {!carregando && !erro && pdm && isStepEmbalagem && (
            <div className="space-y-4">
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                <div className="text-xs font-bold text-emerald-700 uppercase tracking-wider flex items-center gap-2">
                  <Package className="w-4 h-4" /> Embalagem
                </div>
                <div className="text-[11px] text-emerald-600 mt-0.5">
                  Etapa {etapa + 1} de {totalSteps} · Define como o item é vendido (chave pra filtrar cotações equivalentes)
                </div>
              </div>

              <h4 className="text-base font-bold text-gray-800">
                Qual a unidade de fornecimento e capacidade?<span className="text-red-500 ml-1">*</span>
              </h4>

              {carregandoMercado && (
                <div className="text-xs text-gray-500 flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Buscando embalagens reais no mercado público…
                </div>
              )}

              {!carregandoMercado && embalagensMercado.length === 0 && !usarCustomizada && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
                  Não encontrei cotações deste CATMAT no mercado federal pra extrair embalagens.
                  <button onClick={() => setUsarCustomizada(true)} className="ml-1 underline font-semibold">
                    Informar manualmente
                  </button>
                </div>
              )}

              {!carregandoMercado && embalagensMercado.length > 0 && !usarCustomizada && (
                <>
                  <div className="space-y-2 max-h-72 overflow-y-auto">
                    {embalagensMercado.map((emb, idx) => {
                      const total = mercadoData?.totalCotacoes || 1;
                      const pct = Math.round((emb.totalCotacoes / total) * 100);
                      const isSel = embalagem
                        && embalagem.unidadeFornecimento === emb.unidade
                        && embalagem.capacidade === emb.capacidade
                        && embalagem.siglaCapacidade === emb.siglaMedida;
                      return (
                        <button
                          key={idx}
                          onClick={() => setEmbalagem({
                            unidadeFornecimento: emb.unidade,
                            siglaFornecimento: emb.unidade.substring(0, 5).toUpperCase(),
                            capacidade: emb.capacidade,
                            siglaCapacidade: emb.siglaMedida,
                          })}
                          className={`w-full text-left p-3 rounded-lg border-2 transition flex items-center justify-between gap-3 ${
                            isSel ? 'bg-emerald-50 border-emerald-500 ring-2 ring-emerald-200' : 'bg-white border-gray-200 hover:border-emerald-300 hover:bg-emerald-50/50'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div className={`w-4 h-4 rounded-full border-2 shrink-0 ${isSel ? 'border-emerald-500 bg-emerald-500' : 'border-gray-300'}`}>
                              {isSel && <div className="w-1.5 h-1.5 bg-white rounded-full m-auto mt-0.5" />}
                            </div>
                            <div>
                              <div className="font-semibold text-gray-800">
                                {emb.unidade}
                                {emb.capacidade > 0 && (
                                  <span className="text-gray-600 font-normal"> · {emb.capacidade} {emb.siglaMedida.toLowerCase()}</span>
                                )}
                              </div>
                              <div className="text-[10px] text-gray-500">
                                {emb.totalCotacoes} cotações · preço médio R$ {emb.estatisticas.mediano.toFixed(2)}
                              </div>
                            </div>
                          </div>
                          <span className="text-[10px] text-gray-500 italic shrink-0">{pct}% do mercado</span>
                        </button>
                      );
                    })}
                  </div>
                  <button
                    onClick={() => setUsarCustomizada(true)}
                    className="text-xs text-purple-600 hover:text-purple-800 underline"
                  >
                    Nenhuma destas — informar embalagem customizada
                  </button>
                </>
              )}

              {usarCustomizada && (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-3">
                  <div className="text-xs text-gray-600">Informe a embalagem manualmente:</div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Unidade fornecimento</label>
                      <input
                        type="text"
                        placeholder="ex: COPO, GARRAFA, GALÃO"
                        value={embalagemCustomizada.unidade}
                        onChange={e => setEmbalagemCustomizada(p => ({ ...p, unidade: e.target.value.toUpperCase(), siglaFornecimento: e.target.value.toUpperCase().substring(0, 5) }))}
                        className="w-full text-sm p-2 border border-gray-300 rounded focus:border-purple-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Capacidade</label>
                      <div className="flex gap-1">
                        <input
                          type="number"
                          placeholder="200"
                          value={embalagemCustomizada.capacidade || ''}
                          onChange={e => setEmbalagemCustomizada(p => ({ ...p, capacidade: Number(e.target.value) || 0 }))}
                          className="flex-1 text-sm p-2 border border-gray-300 rounded focus:border-purple-500 focus:outline-none"
                        />
                        <select
                          value={embalagemCustomizada.siglaCapacidade}
                          onChange={e => setEmbalagemCustomizada(p => ({ ...p, siglaCapacidade: e.target.value }))}
                          className="text-sm p-2 border border-gray-300 rounded focus:border-purple-500 focus:outline-none"
                        >
                          <option value="ML">ML</option><option value="L">L</option><option value="G">G</option>
                          <option value="KG">KG</option><option value="M">M</option><option value="CM">CM</option>
                          <option value="UN">UN</option>
                        </select>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => setEmbalagem({
                      unidadeFornecimento: embalagemCustomizada.unidade,
                      siglaFornecimento: embalagemCustomizada.siglaFornecimento,
                      capacidade: embalagemCustomizada.capacidade,
                      siglaCapacidade: embalagemCustomizada.siglaCapacidade,
                    })}
                    disabled={!embalagemCustomizada.unidade || embalagemCustomizada.capacidade <= 0}
                    className="w-full py-2 bg-purple-500 text-white text-sm font-bold rounded hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Adotar esta embalagem
                  </button>
                  <button onClick={() => setUsarCustomizada(false)} className="text-xs text-gray-500 hover:underline">
                    Voltar pra lista do mercado
                  </button>
                </div>
              )}

              {embalagem && (
                <div className="bg-emerald-50 border-2 border-emerald-300 rounded-lg p-3 mt-2">
                  <div className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">Embalagem escolhida</div>
                  <div className="text-base font-bold text-gray-800">
                    {embalagem.unidadeFornecimento} {embalagem.capacidade > 0 ? `· ${embalagem.capacidade} ${embalagem.siglaCapacidade.toLowerCase()}` : ''}
                  </div>
                  <div className="text-[11px] text-gray-600 mt-1">
                    Sigla federal: <code className="bg-emerald-100 px-1 rounded">{embalagem.siglaFornecimento}</code>
                    {' · '}
                    Fator conversão: <strong>{embalagem.capacidade} {embalagem.siglaCapacidade}</strong>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {!carregando && !erro && (
          <div className="p-4 bg-gray-50 flex gap-3 border-t shrink-0 items-center">
            {tipoCatalogo === 'material' && pdm && (
              <>
                <button
                  onClick={() => setEtapa(e => Math.max(0, e - 1))}
                  disabled={etapa === 0}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium transition disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1"
                >
                  <ChevronLeft className="w-4 h-4" /> Anterior
                </button>
                <div className="flex-1 text-center text-xs text-gray-500">
                  {Object.keys(respostas).length}/{caracteristicasObrigatorias.length} caract. · {embalagem ? '✓' : '○'} embalagem
                </div>
                {!isUltimoStep ? (
                  <button
                    onClick={() => setEtapa(e => Math.min(totalSteps - 1, e + 1))}
                    disabled={!respondida}
                    className="px-4 py-2 bg-purple-500 text-white font-bold rounded-lg hover:bg-purple-600 transition flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Próxima <ChevronRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    onClick={salvarItem}
                    disabled={!podeFinalizarMaterial || salvando}
                    className="px-4 py-2 bg-green-500 text-white font-bold rounded-lg hover:bg-green-600 transition flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {salvando ? <><Loader2 className="w-4 h-4 animate-spin" /> Salvando…</> : <><CheckCircle2 className="w-4 h-4" /> Finalizar</>}
                  </button>
                )}
              </>
            )}
            {tipoCatalogo === 'servico' && (
              <button
                onClick={salvarItem}
                disabled={salvando}
                className="flex-1 px-4 py-2 bg-green-500 text-white font-bold rounded-lg hover:bg-green-600 transition flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {salvando ? <><Loader2 className="w-4 h-4 animate-spin" /> Salvando…</> : <><CheckCircle2 className="w-4 h-4" /> Confirmar e marcar como completo</>}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
