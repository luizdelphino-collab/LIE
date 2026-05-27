import { useState } from 'react';
import { X, TrendingUp, ExternalLink, RefreshCw, Loader2, Package, Wrench, Award, Calendar, Building2, AlertCircle, CheckCircle2, XCircle, FlaskConical } from 'lucide-react';
import { coletarMercadoItem, type MercadoResposta, type EstatisticasPorUnidade } from '../lib/mercadoApi';
import type { ItemMaster } from '../types';

interface Props {
  item: ItemMaster;
  dados: MercadoResposta;
  onClose: () => void;
  onAtualizar: (novo: MercadoResposta) => void;
  /** Chamado quando o user adota uma embalagem oficial do mercado como unidade do item */
  onAdotarEmbalagem?: (emb: EstatisticasPorUnidade) => Promise<void>;
}

export default function MercadoDetalheModal({ item, dados, onClose, onAtualizar, onAdotarEmbalagem }: Props) {
  const [atualizando, setAtualizando] = useState(false);
  const [adotando, setAdotando] = useState<string | null>(null); // key da unidade sendo adotada
  const [dadosAtuais, setDadosAtuais] = useState(dados);

  const handleAdotar = async (emb: EstatisticasPorUnidade) => {
    if (!onAdotarEmbalagem) return;
    const key = `${emb.unidade}-${emb.capacidade}`;
    setAdotando(key);
    try {
      await onAdotarEmbalagem(emb);
    } finally {
      setAdotando(null);
    }
  };

  const forcarRefresh = async () => {
    if (!item.codigoCatmat) return;
    setAtualizando(true);
    const novo = await coletarMercadoItem(item.codigoCatmat, item.tipoCatmat || 'material', true);
    if (novo) {
      setDadosAtuais(novo);
      onAtualizar(novo);
    }
    setAtualizando(false);
  };

  const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const diff = ((item.valorUnitario - dadosAtuais.estatisticas.mediano) / dadosAtuais.estatisticas.mediano) * 100;
  const corDiff = diff > 20 ? 'text-red-700 bg-red-100' : diff < -20 ? 'text-amber-700 bg-amber-100' : 'text-green-700 bg-green-100';

  const FONTE_LABELS: Record<string, string> = {
    'compras.gov.br': 'COMPRAS.GOV.BR',
    'compras-servico': 'CATSER',
    'pncp-contratacao': 'PNCP — EDITAL',
    'pncp-ata': 'PNCP — ATA',
  };

  // Agrupa cotações por fonte pra mostrar contagem por origem
  const porFonte: Record<string, number> = {};
  dadosAtuais.cotacoes.forEach(c => { porFonte[c.fonte] = (porFonte[c.fonte] || 0) + 1; });

  // Detecta divergência de unidade
  const unidadeItem = (item.unidade || '').toLowerCase();
  const unidadeGov = dadosAtuais.unidadeDominante?.unidade?.toLowerCase() || '';
  const divergeUnidade = unidadeGov && unidadeItem
    && !unidadeGov.includes(unidadeItem.split(/[\s,]/)[0])
    && !unidadeItem.includes(unidadeGov.split(/[\s,]/)[0]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden animate-zoom-in">
        <header className="bg-lie-ink p-4 flex items-center justify-between text-white">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="p-2 bg-blue-500 rounded-lg shrink-0">
              <TrendingUp className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <h3 className="font-bold truncate">Mercado Governamental — {item.nome}</h3>
              <p className="text-xs text-gray-300 truncate">
                {item.tipoCatmat === 'servico' ? 'CATSER' : 'CATMAT'} {item.codigoCatmat}
                {item.nomeCatmatOficial && ` • ${item.nomeCatmatOficial}`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={forcarRefresh}
              disabled={atualizando}
              title="Forçar atualização (ignora cache de 24h)"
              className="p-2 bg-white/10 hover:bg-white/20 rounded transition disabled:opacity-50"
            >
              {atualizando ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            </button>
            <button onClick={onClose} className="hover:bg-white/10 p-2 rounded-full">
              <X className="w-5 h-5" />
            </button>
          </div>
        </header>

        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {/* Painel de Estatísticas */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-center">
              <div className="text-[10px] uppercase font-bold text-blue-700 tracking-wider">Total</div>
              <div className="text-xl font-bold text-blue-900">{dadosAtuais.totalCotacoes}</div>
              <div className="text-[9px] text-blue-600">cotações</div>
            </div>
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-center">
              <div className="text-[10px] uppercase font-bold text-emerald-700 tracking-wider">Mínimo</div>
              <div className="text-base font-bold text-emerald-900">{fmt(dadosAtuais.estatisticas.minimo)}</div>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-center">
              <div className="text-[10px] uppercase font-bold text-amber-700 tracking-wider">Médio</div>
              <div className="text-base font-bold text-amber-900">{fmt(dadosAtuais.estatisticas.medio)}</div>
            </div>
            <div className="bg-lie-green/10 border border-lie-green/30 rounded-lg p-3 text-center">
              <div className="text-[10px] uppercase font-bold text-lie-green tracking-wider">Mediano</div>
              <div className="text-base font-bold text-lie-greenDark">{fmt(dadosAtuais.estatisticas.mediano)}</div>
            </div>
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-center">
              <div className="text-[10px] uppercase font-bold text-red-700 tracking-wider">Máximo</div>
              <div className="text-base font-bold text-red-900">{fmt(dadosAtuais.estatisticas.maximo)}</div>
            </div>
          </div>

          {/* Comparação com nosso preço */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 flex items-center justify-between gap-3 flex-wrap">
            <div className="text-sm">
              <span className="text-gray-500">Nosso preço unitário:</span>{' '}
              <strong className="text-lie-ink">{fmt(item.valorUnitario)} / {item.unidade}</strong>
            </div>
            <div className="text-sm">
              <span className="text-gray-500">Mediana do mercado:</span>{' '}
              <strong className="text-blue-700">
                {fmt(dadosAtuais.estatisticas.mediano)}
                {dadosAtuais.unidadeDominante && (
                  <span className="text-xs text-gray-500 font-normal ml-1">
                    / {dadosAtuais.unidadeDominante.unidade.toLowerCase()}
                    {dadosAtuais.unidadeDominante.capacidade > 0 && ` ${dadosAtuais.unidadeDominante.capacidade}${dadosAtuais.unidadeDominante.siglaMedida.toLowerCase()}`}
                  </span>
                )}
              </strong>
            </div>
            <div className={`text-xs font-bold uppercase tracking-wide px-3 py-1.5 rounded ${corDiff}`}>
              {diff > 5 ? '↑' : diff < -5 ? '↓' : '≈'} Diferença: {Math.abs(diff).toFixed(1)}%
              {Math.abs(diff) < 5 && ' (alinhado)'}
              {diff > 20 && ' (acima do mercado)'}
              {diff < -20 && ' (abaixo do mercado)'}
            </div>
          </div>

          {/* Aviso de divergência de unidade — IMPORTANTE pra evitar comparações enganosas */}
          {divergeUnidade && (
            <div className="bg-amber-50 border-2 border-amber-300 rounded-lg p-3 flex gap-3 items-start">
              <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-900 leading-relaxed">
                <strong className="text-sm block mb-1">⚠ Cuidado: unidades diferentes</strong>
                Seu item está em <strong>"{item.unidade}"</strong>, mas as cotações do mercado
                governamental estão majoritariamente em <strong>"{dadosAtuais.unidadeDominante?.unidade.toLowerCase()}{dadosAtuais.unidadeDominante?.capacidade ? ` ${dadosAtuais.unidadeDominante.capacidade}${dadosAtuais.unidadeDominante.siglaMedida.toLowerCase()}` : ''}"</strong>.
                A comparação direta de preços pode ser <strong>enganosa</strong>. Pra calcular o equivalente
                real, descobra a capacidade da sua embalagem (ex: "caixa com 48 copos de 200ml" =
                48 × 200ml = 9.600ml) e divida o preço pela capacidade total.
                <div className="mt-2 bg-white border border-amber-200 rounded p-2 font-mono text-[11px]">
                  <strong>Exemplo prático:</strong><br />
                  <span className="text-amber-700">Item ({item.unidade}):</span> {fmt(item.valorUnitario)} ÷ ? = R$ ?/{dadosAtuais.unidadeDominante?.siglaMedida.toLowerCase()}<br />
                  {dadosAtuais.unidadeDominante && dadosAtuais.unidadeDominante.capacidade > 0 && dadosAtuais.unidadeDominante.precoPorUnidadeBaseMediano > 0 && (
                    <>
                      <span className="text-blue-700">Mercado ({dadosAtuais.unidadeDominante.unidade.toLowerCase()}):</span>{' '}
                      {fmt(dadosAtuais.unidadeDominante.estatisticas.mediano)} ÷ {dadosAtuais.unidadeDominante.capacidade} = R$ {dadosAtuais.unidadeDominante.precoPorUnidadeBaseMediano.toFixed(4)}/{dadosAtuais.unidadeDominante.siglaMedida.toLowerCase()}
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* === Saneamento Estatístico TCU === */}
          {dadosAtuais.saneamento && (
            <div className="border-2 border-blue-200 rounded-lg overflow-hidden">
              <div className="bg-blue-50 px-3 py-2 border-b border-blue-200 flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <FlaskConical className="w-4 h-4 text-blue-700" />
                  <span className="text-xs font-bold uppercase text-blue-900 tracking-wider">
                    Saneamento Estatístico (Método TCU)
                  </span>
                </div>
                <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                  dadosAtuais.saneamento.metodo === 'media-saneada' ? 'bg-green-100 text-green-800' :
                  dadosAtuais.saneamento.metodo === 'media-original' ? 'bg-blue-100 text-blue-800' :
                  'bg-amber-100 text-amber-800'
                }`}>
                  {dadosAtuais.saneamento.metodo === 'media-saneada' && '✓ Média saneada'}
                  {dadosAtuais.saneamento.metodo === 'media-original' && '✓ Média original (CV inicial ≤ 25%)'}
                  {dadosAtuais.saneamento.metodo === 'mediana-fallback' && '⚠ Fallback mediana (não convergiu)'}
                </span>
              </div>

              <div className="p-3 space-y-2 text-xs">
                {/* Resumo do método */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <div className="bg-gray-50 border border-gray-200 rounded p-2">
                    <div className="text-[10px] uppercase font-bold text-gray-500">Incluídas</div>
                    <div className="text-lg font-bold text-green-700">{dadosAtuais.saneamento.cotacoesIncluidas}</div>
                  </div>
                  <div className="bg-gray-50 border border-gray-200 rounded p-2">
                    <div className="text-[10px] uppercase font-bold text-gray-500">Excluídas</div>
                    <div className="text-lg font-bold text-red-600">{dadosAtuais.saneamento.cotacoesExcluidas}</div>
                  </div>
                  <div className="bg-gray-50 border border-gray-200 rounded p-2">
                    <div className="text-[10px] uppercase font-bold text-gray-500">CV final</div>
                    <div className={`text-lg font-bold ${(dadosAtuais.saneamento.estatisticasFinais.coeficienteVariacao || 0) <= 25 ? 'text-green-700' : 'text-amber-600'}`}>
                      {(dadosAtuais.saneamento.estatisticasFinais.coeficienteVariacao || 0).toFixed(1)}%
                    </div>
                    <div className="text-[9px] text-gray-500">limite: ≤ {dadosAtuais.saneamento.limiteCV}%</div>
                  </div>
                  <div className="bg-blue-50 border border-blue-300 rounded p-2">
                    <div className="text-[10px] uppercase font-bold text-blue-700">Preço de Referência</div>
                    <div className="text-lg font-bold text-blue-900">{fmt(dadosAtuais.saneamento.precoReferencia)}</div>
                  </div>
                </div>

                {/* Memória de cálculo (iterações) */}
                {dadosAtuais.saneamento.iteracoes.length > 0 && (
                  <details className="border border-gray-200 rounded">
                    <summary className="px-2 py-1.5 cursor-pointer text-[11px] font-bold text-gray-700 hover:bg-gray-50">
                      📊 Memória de cálculo ({dadosAtuais.saneamento.iteracoes.length} iteraç{dadosAtuais.saneamento.iteracoes.length === 1 ? 'ão' : 'ões'})
                    </summary>
                    <table className="w-full text-[10px] border-t border-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-2 py-1 text-left">#</th>
                          <th className="px-2 py-1 text-right">n</th>
                          <th className="px-2 py-1 text-right">μ (média)</th>
                          <th className="px-2 py-1 text-right">σ (DP)</th>
                          <th className="px-2 py-1 text-right">CV</th>
                          <th className="px-2 py-1 text-right">Faixa válida</th>
                          <th className="px-2 py-1 text-right">Excluídos</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dadosAtuais.saneamento.iteracoes.map(it => (
                          <tr key={it.iteracao} className="border-t border-gray-100">
                            <td className="px-2 py-1 font-mono">{it.iteracao}</td>
                            <td className="px-2 py-1 text-right">{it.n}</td>
                            <td className="px-2 py-1 text-right font-mono">{fmt(it.media)}</td>
                            <td className="px-2 py-1 text-right font-mono">{fmt(it.desvioPadrao)}</td>
                            <td className={`px-2 py-1 text-right font-mono font-bold ${it.coeficienteVariacao <= 25 ? 'text-green-700' : 'text-amber-700'}`}>
                              {it.coeficienteVariacao.toFixed(1)}%
                            </td>
                            <td className="px-2 py-1 text-right font-mono text-[9px]">
                              {fmt(it.limiteInferior)} — {fmt(it.limiteSuperior)}
                            </td>
                            <td className="px-2 py-1 text-right font-bold text-red-600">
                              {it.excluidosNestaIteracao > 0 ? `−${it.excluidosNestaIteracao}` : '0'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                )}

                <div className="text-[10px] text-gray-500 italic border-t border-gray-200 pt-2">
                  <strong>Fundamento legal:</strong> {dadosAtuais.saneamento.baseLegal}
                </div>
              </div>
            </div>
          )}

          {/* Estatísticas por unidade — sempre mostra, mesmo com 1 unidade */}
          {dadosAtuais.porUnidade && dadosAtuais.porUnidade.length > 0 && (
            <div className="border-2 border-blue-200 rounded-lg overflow-hidden">
              <div className="bg-blue-50 px-3 py-2 border-b border-blue-200 text-xs font-bold uppercase text-blue-900 tracking-wider flex items-center justify-between gap-2 flex-wrap">
                <span>📦 Embalagens disponíveis no mercado</span>
                {onAdotarEmbalagem && (
                  <span className="text-[10px] normal-case text-blue-700 font-normal">
                    Clique em "Adotar" pra usar a mesma unidade que o mercado no seu item
                  </span>
                )}
              </div>
              <div className="divide-y divide-gray-100">
                {dadosAtuais.porUnidade.map((u, idx) => {
                  const key = `${u.unidade}-${u.capacidade}`;
                  const jaEhAtual = item.unidade?.toLowerCase() === u.unidade.toLowerCase()
                    && (item.fatorConversao || 0) === u.capacidade;
                  return (
                    <div key={idx} className="p-2.5 flex items-center gap-3 text-xs hover:bg-blue-50/30 transition">
                      <Package className="w-4 h-4 text-blue-600 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-gray-800">
                          {u.unidade}
                          {u.capacidade > 0 && (
                            <span className="text-blue-700 font-normal ml-1">
                              {u.capacidade} {u.siglaMedida.toLowerCase()}
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-gray-500">{u.totalCotacoes} cotação(ões)</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-bold text-blue-700">{fmt(u.estatisticas.mediano)}</div>
                        <div className="text-[10px] text-gray-500">
                          {fmt(u.estatisticas.minimo)} – {fmt(u.estatisticas.maximo)}
                        </div>
                      </div>
                      {u.precoPorUnidadeBaseMediano > 0 && (
                        <div className="text-right pl-3 border-l border-gray-200 shrink-0">
                          <div className="font-mono text-[11px] font-bold text-green-700">
                            R$ {u.precoPorUnidadeBaseMediano.toFixed(4)}
                          </div>
                          <div className="text-[10px] text-gray-500">por {u.siglaMedida.toLowerCase()}</div>
                        </div>
                      )}
                      {onAdotarEmbalagem && (
                        <button
                          type="button"
                          onClick={() => handleAdotar(u)}
                          disabled={adotando !== null || jaEhAtual}
                          className={`shrink-0 px-3 py-1.5 text-[10px] font-bold uppercase rounded transition flex items-center gap-1 ${
                            jaEhAtual
                              ? 'bg-green-100 text-green-700 cursor-default'
                              : 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm disabled:opacity-50'
                          }`}
                          title={jaEhAtual
                            ? 'Essa já é a embalagem do seu item'
                            : `Adotar ${u.unidade}${u.capacidade ? ' ' + u.capacidade + u.siglaMedida.toLowerCase() : ''} como unidade do item`}
                        >
                          {jaEhAtual ? (
                            <>
                              <CheckCircle2 className="w-3 h-3" />
                              em uso
                            </>
                          ) : adotando === key ? (
                            <>
                              <Loader2 className="w-3 h-3 animate-spin" />
                              salvando…
                            </>
                          ) : (
                            <>
                              <Package className="w-3 h-3" />
                              adotar
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              {onAdotarEmbalagem && (
                <div className="px-3 py-2 bg-blue-50 text-[10px] text-blue-800 italic border-t border-blue-100">
                  Adotar uma embalagem alinha o seu item à mesma unidade do mercado.
                  A comparação fica direta (mesma unidade × mesma unidade), sem matemática
                  pro parecerista.
                </div>
              )}
            </div>
          )}

          {/* Distribuição por fonte */}
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="text-gray-500 font-bold uppercase tracking-wider">Distribuição:</span>
            {Object.entries(porFonte).map(([fonte, count]) => (
              <span key={fonte} className="px-2 py-1 bg-white border border-gray-200 rounded font-mono">
                <strong>{count}</strong> {FONTE_LABELS[fonte] || fonte}
              </span>
            ))}
            <span className="text-gray-400 italic ml-auto">
              {dadosAtuais.fonteCache === 'firestore'
                ? `Cache de ${dadosAtuais.idadeHoras?.toFixed(1) || '?'}h`
                : 'Coleta fresca'}
            </span>
          </div>

          {/* Lista de Cotações */}
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="bg-gray-50 px-3 py-2 border-b border-gray-200 text-xs font-bold uppercase text-gray-700 tracking-wider">
              {dadosAtuais.cotacoes.length} cotações (top 50 mais recentes)
            </div>
            <div className="max-h-[50vh] overflow-y-auto divide-y divide-gray-100">
              {dadosAtuais.cotacoes.length === 0 ? (
                <div className="p-6 text-center text-gray-400 italic">
                  Nenhuma cotação encontrada nas APIs governamentais pra este CATMAT.
                </div>
              ) : (
                dadosAtuais.cotacoes.map((c, idx) => {
                  const fonte = FONTE_LABELS[c.fonte] || c.fonte.toUpperCase();
                  const icone = c.fonte === 'compras-servico' ? <Wrench className="w-4 h-4 text-amber-600" /> :
                                c.fonte === 'pncp-ata' ? <Award className="w-4 h-4 text-purple-600" /> :
                                <Package className="w-4 h-4 text-blue-600" />;
                  return (
                    <div
                      key={idx}
                      className={`p-3 transition flex items-start gap-3 ${
                        c.outlier ? 'bg-red-50/50 hover:bg-red-50' : 'hover:bg-gray-50'
                      }`}
                    >
                      <div className="shrink-0 mt-0.5">
                        {c.outlier ? <XCircle className="w-4 h-4 text-red-500" /> : <CheckCircle2 className="w-4 h-4 text-green-500" />}
                      </div>
                      <div className="shrink-0 mt-0.5">{icone}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[9px] font-bold uppercase text-amber-700 bg-amber-100 border border-amber-200 px-1.5 py-0.5 rounded">
                            {fonte}
                          </span>
                          {c.outlier && (
                            <span className="text-[9px] font-bold uppercase text-red-700 bg-red-100 border border-red-200 px-1.5 py-0.5 rounded" title={c.motivoExclusao || ''}>
                              ✗ Outlier
                            </span>
                          )}
                          <span className={`font-bold text-sm truncate flex-1 ${c.outlier ? 'text-gray-500 line-through' : 'text-lie-ink'}`}>
                            {c.orgao}
                          </span>
                          <div className="text-right">
                            <span className="font-bold text-blue-700 text-sm block">
                              {fmt(c.valorUnitario)}
                            </span>
                            {c.unidadeFornecimento && (
                              <span className="text-[10px] text-gray-500">
                                /{c.unidadeFornecimento.toLowerCase()}
                                {c.capacidadeUnidadeFornecimento > 0 && ` ${c.capacidadeUnidadeFornecimento}${c.siglaUnidadeMedida.toLowerCase()}`}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-[11px] text-gray-500 mt-1 flex items-center gap-2 flex-wrap">
                          {c.marca && <span className="font-bold text-gray-700">{c.marca}</span>}
                          {c.uasg && <span className="flex items-center gap-1"><Building2 className="w-3 h-3" /> UASG {c.uasg}</span>}
                          {c.modalidade && <span>• {c.modalidade}</span>}
                          {c.identificadorCompra && <span>• {c.identificadorCompra}</span>}
                          {c.dataHomologacao && (
                            <span className="flex items-center gap-1">
                              <Calendar className="w-3 h-3" /> {c.dataHomologacao}
                            </span>
                          )}
                          {c.precoPorUnidadeBase > 0 && (
                            <span className="bg-green-50 text-green-700 px-1.5 py-0.5 rounded font-mono">
                              R$ {c.precoPorUnidadeBase.toFixed(4)}/{c.siglaUnidadeMedida.toLowerCase()}
                            </span>
                          )}
                        </div>
                        {c.motivoExclusao && (
                          <div className="text-[10px] text-red-700 mt-1 italic">
                            {c.motivoExclusao}
                          </div>
                        )}
                        {c.linkPncp && (
                          <a
                            href={c.linkPncp}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[11px] text-blue-600 hover:underline mt-1 inline-flex items-center gap-1"
                          >
                            <ExternalLink className="w-3 h-3" />
                            Validar no portal oficial
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <div className="p-3 bg-gray-50 border-t flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-lie-green text-white font-bold rounded-lg hover:bg-lie-greenDark"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
