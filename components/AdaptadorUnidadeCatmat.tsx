import { useState, useMemo, useEffect } from 'react';
import { Loader2, Package, CheckCircle2, X, ArrowRight, AlertCircle } from 'lucide-react';
import type { EstatisticasPorUnidade, MercadoResposta } from '../lib/mercadoApi';

interface AdaptacaoEscolhida {
  unidade: string;
  embalagemDescricao: string;
  fatorConversao: number;
  unidadeBase: string;
  valorUnitario: number;
}

interface Props {
  /** Resposta do mercado pra esse CATMAT */
  mercado: MercadoResposta | null;
  carregando?: boolean;
  /** Unidade atual do item (ex: "caixa") */
  unidadeAtual: string;
  /** Nome do item, usado pra pre-extrair a razao (ex: "ÁGUA caixa 48 copos" → 48) */
  nomeItem: string;
  /** Valor unitário atual do item */
  valorUnitarioAtual: number;
  /** Chamado quando o user confirma a adaptação */
  onAdaptar: (a: AdaptacaoEscolhida) => void;
  /** Chamado quando o user descarta o adaptador */
  onDispensar: () => void;
}

const FMT_BRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const FMT_BRL_4 = (v: number) => v < 0.01 ? `R$ ${v.toFixed(4)}` : FMT_BRL(v);

function extrairRazaoDoNome(nome: string): number | null {
  // Padrões: "caixa 48 copos", "48 unidades", "pacote com 12", "12x", "x12"
  const padroes = [
    /(\d+)\s*(?:un|unidades|copos|garrafas|pacotes|sachês?|saches?|frascos?)/i,
    /(?:caixa|cx|pacote|kit|fardo|cartela)\s*(?:com\s+|c\/\s*)?(\d+)/i,
    /(?:com\s+|c\/\s*)(\d+)\s*(?:un|unidades|copos|garrafas|pacotes)/i,
    /(\d+)\s*[x×]\s*\d/i,
    /[x×]\s*(\d+)/i,
  ];
  for (const p of padroes) {
    const m = nome.match(p);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > 0 && n < 10000) return n;
    }
  }
  return null;
}

export default function AdaptadorUnidadeCatmat({
  mercado,
  carregando,
  unidadeAtual,
  nomeItem,
  valorUnitarioAtual,
  onAdaptar,
  onDispensar
}: Props) {
  const razaoExtraida = useMemo(() => extrairRazaoDoNome(nomeItem), [nomeItem]);
  const [embalagemEscolhida, setEmbalagemEscolhida] = useState<EstatisticasPorUnidade | null>(null);
  const [razao, setRazao] = useState<string>(razaoExtraida ? String(razaoExtraida) : '');

  // Reset escolha quando muda a resposta do mercado
  useEffect(() => {
    setEmbalagemEscolhida(null);
    setRazao(razaoExtraida ? String(razaoExtraida) : '');
  }, [mercado?.codigoCatmat, razaoExtraida]);

  // Auto-seleciona se só houver 1 embalagem
  useEffect(() => {
    if (mercado?.porUnidade?.length === 1) {
      setEmbalagemEscolhida(mercado.porUnidade[0]);
    }
  }, [mercado]);

  if (carregando) {
    return (
      <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
        <span className="text-xs text-blue-800">Buscando como o mercado público cota esse CATMAT…</span>
      </div>
    );
  }

  if (!mercado || !mercado.porUnidade || mercado.porUnidade.length === 0) {
    return (
      <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
        <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="text-xs text-amber-900 font-semibold">
            Sem cotações públicas disponíveis pra este CATMAT no momento.
          </div>
          <div className="text-[11px] text-amber-700 mt-1">
            Sem cotações não dá pra sugerir adaptação de unidade. Mantenha como está e tente
            novamente em alguns dias (a busca pode reaparecer quando novos pregões forem homologados).
          </div>
          <button
            type="button"
            onClick={onDispensar}
            className="mt-2 text-[10px] text-amber-700 hover:text-amber-900 underline font-semibold uppercase"
          >
            Dispensar
          </button>
        </div>
      </div>
    );
  }

  const embalagens = mercado.porUnidade;
  const unidadeAtualNorm = unidadeAtual.toLowerCase();
  const algumaEmbBateUnidadeAtual = embalagens.some(e => e.unidade.toLowerCase() === unidadeAtualNorm);

  // Se a unidade atual já bate com alguma embalagem do mercado, não força adaptação
  if (algumaEmbBateUnidadeAtual && !embalagemEscolhida) {
    return (
      <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg flex items-start gap-2">
        <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="text-xs text-green-900 font-semibold">
            Sua unidade atual (<strong>{unidadeAtual}</strong>) bate com uma embalagem do mercado.
          </div>
          <div className="text-[11px] text-green-800 mt-1">
            Comparação de preços já vai funcionar diretamente — sem precisar adaptar.
          </div>
        </div>
      </div>
    );
  }

  // Razão -> validação
  const razaoNum = parseInt(razao, 10);
  const razaoValida = !isNaN(razaoNum) && razaoNum > 0;
  const novoPrecoUnitario = embalagemEscolhida && razaoValida
    ? valorUnitarioAtual / razaoNum
    : null;

  const handleConfirmar = () => {
    if (!embalagemEscolhida || !razaoValida || novoPrecoUnitario === null) return;
    onAdaptar({
      unidade: 'unidade', // padroniza pra "unidade" (cada unidade = 1 catalog item)
      embalagemDescricao: embalagemEscolhida.capacidade > 0
        ? `${embalagemEscolhida.unidade.toLowerCase()} ${embalagemEscolhida.capacidade}${embalagemEscolhida.siglaMedida.toLowerCase()}`
        : embalagemEscolhida.unidade.toLowerCase(),
      fatorConversao: embalagemEscolhida.capacidade > 0 ? embalagemEscolhida.capacidade : 1,
      unidadeBase: embalagemEscolhida.siglaMedida || 'UN',
      valorUnitario: Number(novoPrecoUnitario.toFixed(4)),
    });
  };

  return (
    <div className="mt-3 p-3 bg-blue-50 border border-blue-300 rounded-lg space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <Package className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
          <div>
            <div className="text-xs font-bold text-blue-900">
              Adaptar unidade do item à unidade do catálogo público
            </div>
            <div className="text-[11px] text-blue-800 mt-0.5">
              Sua unidade atual é <strong>{unidadeAtual}</strong> mas o mercado cota esse CATMAT
              em embalagens diferentes. Escolha qual representa o que você compra no projeto pra
              que a comparação de preços fique correta.
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onDispensar}
          className="text-blue-600 hover:text-blue-900 shrink-0"
          title="Dispensar"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Lista de embalagens encontradas */}
      <div className="space-y-1.5">
        <div className="text-[10px] font-bold uppercase tracking-wider text-blue-700">
          {embalagens.length} embalagem(ns) encontrada(s) no mercado:
        </div>
        {embalagens.map((e, idx) => {
          const sel = embalagemEscolhida === e;
          const chave = `${e.unidade}-${e.capacidade}-${e.siglaMedida}`;
          return (
            <label
              key={`${chave}-${idx}`}
              className={`flex items-center gap-2 p-2 rounded cursor-pointer border transition ${
                sel ? 'bg-blue-100 border-blue-400' : 'bg-white border-blue-100 hover:bg-blue-50'
              }`}
            >
              <input
                type="radio"
                name="embalagem-escolhida"
                checked={sel}
                onChange={() => setEmbalagemEscolhida(e)}
                className="text-blue-600"
              />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold text-lie-ink">
                  {e.unidade}
                  {e.capacidade > 0 && <> <span className="text-blue-700">{e.capacidade} {e.siglaMedida}</span></>}
                </div>
                <div className="text-[10px] text-gray-600">
                  {e.totalCotacoes} cotação(ões) · mediana <strong>{FMT_BRL_4(e.estatisticas.mediano)}</strong>
                  {' '}({FMT_BRL_4(e.estatisticas.minimo)} – {FMT_BRL_4(e.estatisticas.maximo)})
                </div>
              </div>
            </label>
          );
        })}
      </div>

      {/* Razão e cálculo */}
      {embalagemEscolhida && (
        <div className="bg-white border border-blue-200 rounded p-2.5 space-y-2">
          <div className="text-[11px] text-blue-900 leading-relaxed">
            Quantos <strong>{embalagemEscolhida.unidade.toLowerCase()}
            {embalagemEscolhida.capacidade > 0 && ` ${embalagemEscolhida.capacidade}${embalagemEscolhida.siglaMedida.toLowerCase()}`}
            </strong> há em <strong>1 {unidadeAtual}</strong>?
            {razaoExtraida && (
              <span className="text-gray-500 ml-1">
                (sugerido pelo nome: {razaoExtraida})
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              step={1}
              value={razao}
              onChange={e => setRazao(e.target.value)}
              placeholder="ex: 48"
              className="w-24 px-2 py-1 border border-blue-300 rounded text-sm font-mono"
            />
            <span className="text-[11px] text-gray-600">
              {embalagemEscolhida.unidade.toLowerCase()}
              {embalagemEscolhida.capacidade > 0 && ` ${embalagemEscolhida.capacidade}${embalagemEscolhida.siglaMedida.toLowerCase()}`}
              {' '}por {unidadeAtual}
            </span>
          </div>

          {/* Preview do cálculo */}
          {razaoValida && novoPrecoUnitario !== null && (
            <div className="flex items-center gap-2 text-[11px] bg-green-50 border border-green-200 rounded p-2">
              <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
              <div className="flex-1">
                <span className="text-gray-700">
                  De <strong>{FMT_BRL(valorUnitarioAtual)}/{unidadeAtual}</strong>
                </span>
                <ArrowRight className="inline w-3 h-3 mx-1 text-gray-400" />
                <span className="text-green-800 font-bold">
                  {FMT_BRL_4(novoPrecoUnitario)}/{embalagemEscolhida.unidade.toLowerCase()}
                  {embalagemEscolhida.capacidade > 0 && ` ${embalagemEscolhida.capacidade}${embalagemEscolhida.siglaMedida.toLowerCase()}`}
                </span>
                <div className="text-gray-500 text-[10px] mt-0.5">
                  {FMT_BRL(valorUnitarioAtual)} ÷ {razaoNum} = {FMT_BRL_4(novoPrecoUnitario)}
                  {' · '}fator: {embalagemEscolhida.capacidade > 0 ? `${embalagemEscolhida.capacidade} ${embalagemEscolhida.siglaMedida}` : 'unidade'}
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onDispensar}
              className="px-3 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-100 rounded"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleConfirmar}
              disabled={!razaoValida || novoPrecoUnitario === null}
              className="px-3 py-1.5 text-xs font-bold bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              Adaptar unidade
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
