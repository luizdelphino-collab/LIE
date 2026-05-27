import { useState } from 'react';
import { X, TrendingUp, ExternalLink, RefreshCw, Loader2, Package, Wrench, Award, Calendar, Building2, AlertCircle } from 'lucide-react';
import { coletarMercadoItem, type MercadoResposta } from '../lib/mercadoApi';
import type { ItemMaster } from '../types';

interface Props {
  item: ItemMaster;
  dados: MercadoResposta;
  onClose: () => void;
  onAtualizar: (novo: MercadoResposta) => void;
}

export default function MercadoDetalheModal({ item, dados, onClose, onAtualizar }: Props) {
  const [atualizando, setAtualizando] = useState(false);
  const [dadosAtuais, setDadosAtuais] = useState(dados);

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

          {/* Estatísticas por unidade — quando há mais de uma */}
          {dadosAtuais.porUnidade && dadosAtuais.porUnidade.length > 1 && (
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <div className="bg-gray-50 px-3 py-2 border-b border-gray-200 text-xs font-bold uppercase text-gray-700 tracking-wider">
                Distribuição por Unidade de Fornecimento
              </div>
              <div className="divide-y divide-gray-100">
                {dadosAtuais.porUnidade.map((u, idx) => (
                  <div key={idx} className="p-2.5 flex items-center gap-3 text-xs">
                    <div className="flex-1">
                      <div className="font-bold text-gray-800">
                        {u.unidade}
                        {u.capacidade > 0 && (
                          <span className="text-gray-500 font-normal ml-1">
                            ({u.capacidade} {u.siglaMedida.toLowerCase()})
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-gray-500">{u.totalCotacoes} cotação(ões)</div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-blue-700">{fmt(u.estatisticas.mediano)}</div>
                      <div className="text-[10px] text-gray-500">
                        {fmt(u.estatisticas.minimo)} – {fmt(u.estatisticas.maximo)}
                      </div>
                    </div>
                    {u.precoPorUnidadeBaseMediano > 0 && (
                      <div className="text-right pl-3 border-l border-gray-200">
                        <div className="font-mono text-[11px] font-bold text-green-700">
                          R$ {u.precoPorUnidadeBaseMediano.toFixed(4)}
                        </div>
                        <div className="text-[10px] text-gray-500">por {u.siglaMedida.toLowerCase()}</div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
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
                    <div key={idx} className="p-3 hover:bg-gray-50 transition flex items-start gap-3">
                      <div className="shrink-0 mt-0.5">{icone}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[9px] font-bold uppercase text-amber-700 bg-amber-100 border border-amber-200 px-1.5 py-0.5 rounded">
                            {fonte}
                          </span>
                          <span className="font-bold text-sm text-lie-ink truncate flex-1">
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
