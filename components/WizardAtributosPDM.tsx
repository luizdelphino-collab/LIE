// Wizard de atributos PDM - Fase 3 redesign 2026-05-29
//
// Apresenta uma pergunta por caracteristica obrigatoria do PDM vinculado ao item,
// permitindo escolher o valor entre os enumerados oficialmente pelo SERPRO CNBS.
// Resultado: atributosWizard preenchido + precisaCompletarWizard = false.

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, CheckCircle2, Loader2, X, AlertTriangle, Database } from 'lucide-react';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { getPdmFromCache, getServicoFromCache, sincronizarCatalogoCNBS, type PdmCache, type ServicoCache } from '../lib/catalogoPdmsApi';
import type { ItemMaster } from '../types';

interface WizardAtributosPDMProps {
  item: ItemMaster;
  onClose: () => void;
  onComplete: () => void;
}

type RespostasMap = Record<string, { codigoValor: string; nomeValor: string; siglaUM?: string | null }>;

export default function WizardAtributosPDM({ item, onClose, onComplete }: WizardAtributosPDMProps) {
  const [pdm, setPdm] = useState<PdmCache | null>(null);
  const [servico, setServico] = useState<ServicoCache | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [carregandoMsg, setCarregandoMsg] = useState('Buscando dados do catálogo no cache local…');
  const [erro, setErro] = useState<string | null>(null);
  const [etapa, setEtapa] = useState(0);
  const [respostas, setRespostas] = useState<RespostasMap>({});
  const [salvando, setSalvando] = useState(false);

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
        // Não está no cache — sincroniza
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

      // tipo material: tenta cache primeiro
      // Como nao sabemos o codigoPdm do item sem consulta extra, fazemos sync que retorna o PDM
      setCarregandoMsg('Buscando características do PDM no cache…');
      const syncResp = await sincronizarCatalogoCNBS({ codigosCatmat: [item.codigoCatmat] });
      if (!syncResp || syncResp.pdmsAtualizados === 0) {
        setErro('Não consegui resolver o PDM deste item. Tente "Sincronizar Catálogo" no header e tente novamente.');
        setCarregando(false);
        return;
      }

      // Agora descobre qual eh o codigoPdm percorrendo os pdms do batch
      // Mais simples: chama API de cache pra achar PDM que contem esse codigoItem
      // Usamos findPdmByItem do lib (mas seria N+1 query). Em vez disso vamos buscar do retorno do sync.
      // Como sync ja salvou no Firestore, fazemos uma busca no cache:
      const { findPdmByItem } = await import('../lib/catalogoPdmsApi');
      const pdmEncontrado = await findPdmByItem(item.codigoCatmat);
      if (!pdmEncontrado) {
        setErro('PDM encontrado no SERPRO mas não consegui localizar no cache local. Tente sincronizar novamente.');
        setCarregando(false);
        return;
      }
      setPdm(pdmEncontrado);

      // Pre-popula respostas com atributos ja salvos (edicao do wizard)
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
        // Pre-popula com o item especifico vinculado (se houver)
        const itemVinculado = pdmEncontrado.itensVinculados.find(iv => iv.codigoItem === item.codigoCatmat);
        if (itemVinculado) {
          const respPre: RespostasMap = {};
          for (const a of itemVinculado.atributos) {
            respPre[a.codigo] = {
              codigoValor: a.codigoValor,
              nomeValor: a.nomeValor,
            };
          }
          setRespostas(respPre);
        }
      }

      setCarregando(false);
    };
    carregarCatalogo();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.codigoCatmat]);

  // Caracteristicas obrigatorias do PDM ordenadas por numeroCaracteristica
  const caracteristicasObrigatorias = (pdm?.caracteristicas || [])
    .filter(c => c.obrigatoria && c.valores.some(v => v.ativo))
    .sort((a, b) => a.numero - b.numero);

  const totalEtapas = tipoCatalogo === 'servico' ? 1 : caracteristicasObrigatorias.length;
  const etapaAtual = caracteristicasObrigatorias[etapa];
  const respondida = etapaAtual ? !!respostas[etapaAtual.codigo] : false;

  // Frequencia de cada valor entre os itens vinculados do PDM
  // (usado pra mostrar "X% dos itens vinculados usam este valor")
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
        // Servicos: nao tem caracteristicas obrigatorias do mesmo modelo PDM
        await setDoc(doc(db, 'items', item.id), {
          atributosWizard: [],
          atributosWizardCompletoEm: serverTimestamp(),
          precisaCompletarWizard: false,
        }, { merge: true });
      } else {
        // Materials: monta array de atributos a partir das respostas
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
        await setDoc(doc(db, 'items', item.id), {
          atributosWizard: atributos,
          atributosWizardCompletoEm: serverTimestamp(),
          precisaCompletarWizard: false,
        }, { merge: true });
      }
      onComplete();
    } catch (e: any) {
      setErro(`Erro ao salvar: ${e?.message || e}`);
      setSalvando(false);
    }
  };

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

          {/* CATSER — wizard simples: confirma que o servico cobre o item */}
          {!carregando && !erro && servico && (
            <div className="space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="text-xs font-bold text-blue-700 uppercase tracking-wider mb-1">Serviço CATSER {servico.codigoServico}</div>
                <div className="text-lg font-bold text-gray-800">{servico.descricao}</div>
                <div className="text-xs text-gray-600 mt-1">
                  Grupo: <strong>{servico.nomeGrupo}</strong>
                </div>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
                <strong>Nota sobre serviços:</strong> CATSER não tem atributos estruturados como CATMAT.
                A pesquisa de preço de serviços vai usar descrição livre + filtros temporais + segmentação geográfica.
                Confirme abaixo se este CATSER realmente descreve o item.
              </div>
              <div className="flex gap-2 items-center">
                <input type="checkbox" id="confirmCatser" className="rounded" defaultChecked />
                <label htmlFor="confirmCatser" className="text-sm text-gray-700">
                  Sim, este CATSER descreve corretamente o item "{item.nome}".
                </label>
              </div>
            </div>
          )}

          {/* CATMAT — wizard com perguntas por caracteristica */}
          {!carregando && !erro && pdm && etapaAtual && (
            <div className="space-y-4">
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
                <div className="text-xs font-bold text-purple-700 uppercase tracking-wider">
                  PDM {pdm.codigoPdm} — {pdm.nomePdm}
                </div>
                <div className="text-[11px] text-purple-600 mt-0.5">
                  Pergunta {etapa + 1} de {totalEtapas} · {pdm.itensVinculados.length} variações catalogadas
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
                          [etapaAtual.codigo]: {
                            codigoValor: v.codigo,
                            nomeValor: v.nome,
                            siglaUM: v.siglaUnidadeMedida,
                          },
                        }))}
                        className={`w-full text-left p-3 rounded-lg border-2 transition flex items-center justify-between gap-3 ${
                          sel
                            ? 'bg-purple-50 border-purple-500 ring-2 ring-purple-200'
                            : 'bg-white border-gray-200 hover:border-purple-300 hover:bg-purple-50/50'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-4 h-4 rounded-full border-2 shrink-0 ${
                            sel ? 'border-purple-500 bg-purple-500' : 'border-gray-300'
                          }`}>
                            {sel && <div className="w-1.5 h-1.5 bg-white rounded-full m-auto mt-0.5" />}
                          </div>
                          <div>
                            <div className="font-semibold text-gray-800">{v.nome}</div>
                            {v.siglaUnidadeMedida && (
                              <div className="text-[10px] text-gray-500">Unidade: {v.siglaUnidadeMedida}</div>
                            )}
                          </div>
                        </div>
                        {freq > 0 && (
                          <span className="text-[10px] text-gray-500 italic shrink-0">
                            {freq}% das variações
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="text-[11px] text-gray-500 italic">
                ⓘ "% das variações" mostra com que frequência esse valor aparece nos {pdm.itensVinculados.length} itens
                catalogados deste PDM. Sinaliza qual é o uso mais comum no mercado público.
              </div>
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
                  {Object.keys(respostas).length} / {totalEtapas} respondidas
                </div>
                {etapa < totalEtapas - 1 ? (
                  <button
                    onClick={() => setEtapa(e => Math.min(totalEtapas - 1, e + 1))}
                    disabled={!respondida}
                    className="px-4 py-2 bg-purple-500 text-white font-bold rounded-lg hover:bg-purple-600 transition flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Próxima <ChevronRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    onClick={salvarItem}
                    disabled={Object.keys(respostas).length < totalEtapas || salvando}
                    className="px-4 py-2 bg-green-500 text-white font-bold rounded-lg hover:bg-green-600 transition flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {salvando ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Salvando…</>
                    ) : (
                      <><CheckCircle2 className="w-4 h-4" /> Finalizar</>
                    )}
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
                {salvando ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Salvando…</>
                ) : (
                  <><CheckCircle2 className="w-4 h-4" /> Confirmar e marcar como completo</>
                )}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
