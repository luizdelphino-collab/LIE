/**
 * components/ReferenciaPrecoMercado.tsx
 *
 * Painel de referência de preço pra itens SEM embalagem (serviços e itens
 * cotados por unidade). Em vez de pedir pro usuário interpretar embalagem/
 * conversão (que não existe pra serviço), mostra direto o preço de referência
 * SANEADO (metodologia TCU) que a Cloud Function já calcula — escondendo a
 * faixa bruta cheia de outliers — e oferece adotar com um clique.
 */

import { TrendingUp, CheckCircle2, ShieldCheck, Info } from 'lucide-react';
import type { MercadoResposta } from '../lib/mercadoApi';

const FMT = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

interface Props {
  mercado: MercadoResposta;
  valorAtual: number;
  /** Aplica o preço de referência no valorUnitario do item. */
  onUsar: (valor: number) => void;
}

export default function ReferenciaPrecoMercado({ mercado, valorAtual, onUsar }: Props) {
  const san = mercado.saneamento;
  const ref = san?.precoReferencia ?? mercado.estatisticas?.mediano ?? 0;
  const total = mercado.totalCotacoes || 0;

  if (!ref || total === 0) {
    return (
      <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
        <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <div className="text-[11px] text-amber-800">
          Ainda não há cotações públicas suficientes pra calcular uma referência de preço
          pra este item. Você pode salvar mesmo assim e tentar a pesquisa de preço depois,
          ou usar a rota de 3 orçamentos.
        </div>
      </div>
    );
  }

  const jaNaReferencia = valorAtual > 0 && Math.abs(valorAtual - ref) / ref < 0.01;
  const min = mercado.estatisticas?.minimo ?? 0;
  const max = mercado.estatisticas?.maximo ?? 0;

  return (
    <div className="rounded-lg border-2 border-emerald-200 bg-emerald-50/40 overflow-hidden">
      <div className="bg-emerald-100/70 px-3 py-2 flex items-center gap-2">
        <TrendingUp className="w-4 h-4 text-emerald-700 shrink-0" />
        <span className="text-xs font-bold text-emerald-900">
          Como o mercado público cota este item
        </span>
      </div>

      <div className="p-3 space-y-3">
        <p className="text-[11px] text-gray-600 leading-relaxed">
          Este item é cotado <strong>por unidade</strong> — sem embalagem ou conversão (típico de
          serviços e locações). O sistema já calculou o preço de referência removendo os valores
          fora da curva.
        </p>

        {/* Número de referência */}
        <div className="flex items-center justify-between gap-3 bg-white border border-emerald-200 rounded-lg p-3">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5" />
              Preço de referência (saneado)
            </div>
            <div className="text-2xl font-bold text-emerald-900 font-mono mt-0.5">{FMT(ref)}</div>
          </div>
          {jaNaReferencia ? (
            <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-700">
              <CheckCircle2 className="w-4 h-4" /> valor do item já está na referência
            </span>
          ) : (
            <button
              type="button"
              onClick={() => onUsar(ref)}
              className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg shadow-sm flex items-center gap-1.5 shrink-0"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              Usar {FMT(ref)}
            </button>
          )}
        </div>

        {/* Como foi calculado — transparência */}
        {san ? (
          <div className="text-[11px] text-gray-600 leading-relaxed">
            Calculado de <strong>{san.cotacoesIncluidas}</strong> cotações válidas
            {san.cotacoesExcluidas > 0 && (
              <> — <strong>{san.cotacoesExcluidas}</strong> valores fora da curva descartados</>
            )}{' '}
            (de {total} no total). Método: <em>{san.metodo === 'media-saneada' ? 'média saneada' : san.metodo}</em>
            {san.convergiu ? ' (convergiu)' : ''}. Base legal: {san.baseLegal || 'IN 65/2021 + Acórdão TCU 1445/2015'}.
            {max > 0 && min >= 0 && max / Math.max(min, 0.01) > 5 && (
              <div className="mt-1 text-gray-400">
                Faixa bruta descartada: <s>{FMT(min)} – {FMT(max)}</s> (continha distorções).
              </div>
            )}
          </div>
        ) : (
          <div className="text-[11px] text-gray-500">
            Referência pela mediana de {total} cotações públicas.
          </div>
        )}
      </div>
    </div>
  );
}
