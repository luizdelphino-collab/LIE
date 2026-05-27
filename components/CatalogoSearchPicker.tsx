import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, Loader2, CheckCircle2, AlertCircle, ChevronRight, ArrowLeft,
  Package, Wrench, Sparkles, X
} from 'lucide-react';
import {
  buscarPdmsPorPalavra, buscarServicosPorPalavra, listarItensDoPdm,
  formatarCaracteristicas,
  type PdmMatch, type ServicoMatch, type ItemDoPdm
} from '../lib/catalogoApi';

export interface CatalogoSelecao {
  codigoCatmat: number;
  tipoCatmat: 'material' | 'servico';
  nomeCatmatOficial: string;
  descricaoCatmatOficial: string;
}

interface Props {
  /** Nome inicial do item (usado pra pré-busca automática). */
  initialTermo?: string;
  /** Chamado quando o usuário seleciona um CATMAT/CATSER oficial. */
  onSelect: (selecao: CatalogoSelecao, sugestaoNome: string) => void;
  /** Chamado quando o usuário cancela ou limpa. */
  onClear?: () => void;
  /** Já selecionado? Renderiza compacto com botão "Trocar". */
  selecionado?: CatalogoSelecao | null;
}

type Modo = 'busca' | 'itens-pdm';

const DEBOUNCE_MS = 400;

export default function CatalogoSearchPicker({ initialTermo, onSelect, onClear, selecionado }: Props) {
  const [termo, setTermo] = useState(initialTermo || '');
  const [tipo, setTipo] = useState<'material' | 'servico'>('material');
  const [buscando, setBuscando] = useState(false);
  const [pdms, setPdms] = useState<PdmMatch[]>([]);
  const [servicos, setServicos] = useState<ServicoMatch[]>([]);

  const [modo, setModo] = useState<Modo>('busca');
  const [pdmSelecionado, setPdmSelecionado] = useState<PdmMatch | null>(null);
  const [itensPdm, setItensPdm] = useState<ItemDoPdm[]>([]);
  const [carregandoItens, setCarregandoItens] = useState(false);

  const [autoBuscaFeita, setAutoBuscaFeita] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Busca debounced sempre que termo/tipo mudar
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (selecionado) return;
    if (!termo || termo.trim().length < 2) {
      setPdms([]);
      setServicos([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setBuscando(true);
      try {
        if (tipo === 'material') {
          const r = await buscarPdmsPorPalavra(termo);
          setPdms(r);
        } else {
          const r = await buscarServicosPorPalavra(termo);
          setServicos(r);
        }
      } finally {
        setBuscando(false);
      }
    }, DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [termo, tipo, selecionado]);

  // Auto-busca uma vez quando há initialTermo
  useEffect(() => {
    if (initialTermo && !autoBuscaFeita && !selecionado) {
      setTermo(initialTermo);
      setAutoBuscaFeita(true);
    }
  }, [initialTermo, autoBuscaFeita, selecionado]);

  const abrirItensDoPdm = async (pdm: PdmMatch) => {
    setPdmSelecionado(pdm);
    setModo('itens-pdm');
    setCarregandoItens(true);
    try {
      const items = await listarItensDoPdm(pdm.codigoPdm);
      setItensPdm(items);
    } finally {
      setCarregandoItens(false);
    }
  };

  const voltar = () => {
    setModo('busca');
    setPdmSelecionado(null);
    setItensPdm([]);
  };

  const aplicarItem = (item: ItemDoPdm, pdm: PdmMatch) => {
    const caract = formatarCaracteristicas(item);
    const desc = item.descricaoCompleta
      || (caract ? `${pdm.nomePdm.toUpperCase()} — ${caract}` : pdm.nomePdm.toUpperCase());
    onSelect(
      {
        codigoCatmat: item.codigoItem,
        tipoCatmat: 'material',
        nomeCatmatOficial: pdm.nomePdm || '',
        descricaoCatmatOficial: desc
      },
      pdm.nomePdm || ''
    );
  };

  const aplicarServico = (s: ServicoMatch) => {
    const nome = s.descricaoServicoAcentuado || s.descricaoServico || '';
    onSelect(
      {
        codigoCatmat: s.codigoServico,
        tipoCatmat: 'servico',
        nomeCatmatOficial: nome,
        descricaoCatmatOficial: nome
      },
      nome
    );
  };

  // === Modo COMPACTO quando já há seleção ===
  if (selecionado) {
    return (
      <div className="p-3 bg-green-50 border-2 border-green-300 rounded-lg space-y-1">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 text-sm font-bold text-green-900">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              {selecionado.tipoCatmat === 'material' ? 'CATMAT' : 'CATSER'} oficial validado
              <span className="font-mono bg-white border border-green-200 px-1.5 py-0.5 rounded text-[11px]">
                {selecionado.codigoCatmat}
              </span>
            </div>
            <div className="text-xs text-green-800 mt-1 font-bold">
              {selecionado.nomeCatmatOficial}
            </div>
            {selecionado.descricaoCatmatOficial && (
              <div className="text-[11px] text-green-700 mt-0.5 leading-snug">
                {selecionado.descricaoCatmatOficial}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClear}
            className="text-[10px] uppercase font-bold text-red-600 hover:text-red-800 underline shrink-0"
          >
            Trocar
          </button>
        </div>
      </div>
    );
  }

  // === Modo BUSCA ===
  const totalResultados = tipo === 'material' ? pdms.length : servicos.length;

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
      {/* Seletor tipo + busca */}
      {modo === 'busca' && (
        <>
          <div className="p-3 border-b border-gray-100 bg-gray-50/50 space-y-2">
            <div className="flex gap-1.5 bg-white border border-gray-200 rounded-lg p-1">
              <button
                type="button"
                onClick={() => setTipo('material')}
                className={`flex-1 px-3 py-1.5 text-xs font-bold rounded-md transition flex items-center justify-center gap-1.5 ${
                  tipo === 'material' ? 'bg-lie-green text-white shadow-sm' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Package className="w-3.5 h-3.5" />
                CATMAT (material)
              </button>
              <button
                type="button"
                onClick={() => setTipo('servico')}
                className={`flex-1 px-3 py-1.5 text-xs font-bold rounded-md transition flex items-center justify-center gap-1.5 ${
                  tipo === 'servico' ? 'bg-lie-green text-white shadow-sm' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Wrench className="w-3.5 h-3.5" />
                CATSER (serviço)
              </button>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder={`Digite uma palavra-chave (ex: ${tipo === 'material' ? 'água, ônibus, bola' : 'limpeza, transporte, vigilância'})`}
                value={termo}
                onChange={e => setTermo(e.target.value)}
                className="w-full pl-9 pr-9 py-2 border border-gray-300 rounded-md text-sm focus:ring-lie-green focus:border-lie-green"
              />
              {termo && (
                <button
                  type="button"
                  onClick={() => setTermo('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {termo.length >= 2 && (
              <div className="text-[11px] text-gray-500 flex items-center gap-1">
                {buscando ? (
                  <><Loader2 className="w-3 h-3 animate-spin" /> Buscando no catálogo Compras.gov.br…</>
                ) : (
                  <>
                    {totalResultados} {tipo === 'material' ? 'PDM(s)' : 'serviço(s)'} encontrado(s)
                    {totalResultados > 0 && tipo === 'material' && ' — clique pra ver os itens'}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Lista de resultados */}
          <div className="max-h-[280px] overflow-y-auto divide-y divide-gray-100">
            {tipo === 'material' && pdms.map(pdm => (
              <button
                key={pdm.codigoPdm}
                type="button"
                onClick={() => abrirItensDoPdm(pdm)}
                className="w-full text-left p-3 hover:bg-amber-50 transition flex items-start gap-3 group"
              >
                <div className="font-mono text-[10px] font-bold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded shrink-0 mt-0.5">
                  PDM {pdm.codigoPdm}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm text-lie-ink truncate group-hover:text-amber-700">
                    {pdm.nomePdm}
                  </div>
                  {(pdm.nomeClasse || pdm.descricaoGrupo) && (
                    <div className="text-[11px] text-gray-500 mt-0.5">
                      {pdm.nomeClasse && <span>Classe: {pdm.nomeClasse}</span>}
                      {pdm.descricaoGrupo && <span> • {pdm.descricaoGrupo}</span>}
                    </div>
                  )}
                </div>
                <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-amber-600 shrink-0 mt-1" />
              </button>
            ))}

            {tipo === 'servico' && servicos.map(s => (
              <button
                key={s.codigoServico}
                type="button"
                onClick={() => aplicarServico(s)}
                className="w-full text-left p-3 hover:bg-amber-50 transition flex items-start gap-3 group"
              >
                <div className="font-mono text-[10px] font-bold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded shrink-0 mt-0.5">
                  CATSER {s.codigoServico}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm text-lie-ink truncate group-hover:text-amber-700">
                    {s.descricaoServicoAcentuado || s.descricaoServico}
                  </div>
                  {s.nomeGrupo && (
                    <div className="text-[11px] text-gray-500 mt-0.5">Grupo: {s.nomeGrupo}</div>
                  )}
                </div>
                <Sparkles className="w-4 h-4 text-amber-500 opacity-0 group-hover:opacity-100 shrink-0 mt-1" />
              </button>
            ))}

            {termo.length >= 2 && !buscando && totalResultados === 0 && (
              <div className="p-6 text-center text-xs text-gray-400">
                <AlertCircle className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                Nenhum {tipo === 'material' ? 'PDM' : 'serviço'} encontrado pra "<strong>{termo}</strong>".
                <br />Tente outra palavra-chave ou troque pra {tipo === 'material' ? 'CATSER (serviço)' : 'CATMAT (material)'}.
              </div>
            )}

            {termo.length < 2 && (
              <div className="p-6 text-center text-xs text-gray-400">
                Digite uma palavra-chave acima pra buscar o código oficial no catálogo Compras.gov.br.
              </div>
            )}
          </div>
        </>
      )}

      {/* === Modo itens do PDM === */}
      {modo === 'itens-pdm' && pdmSelecionado && (
        <>
          <div className="p-3 border-b border-amber-200 bg-amber-50 flex items-start gap-2">
            <button
              type="button"
              onClick={voltar}
              className="p-1 text-amber-700 hover:bg-amber-100 rounded transition shrink-0"
              title="Voltar"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold text-amber-900">
                PDM {pdmSelecionado.codigoPdm} — {pdmSelecionado.nomePdm}
              </div>
              <div className="text-[11px] text-amber-700">
                Selecione o item específico (CATMAT) com as características exatas:
              </div>
            </div>
          </div>

          <div className="max-h-[300px] overflow-y-auto divide-y divide-gray-100">
            {carregandoItens && (
              <div className="p-6 text-center text-xs text-gray-500">
                <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-amber-600" />
                Carregando itens do PDM…
              </div>
            )}

            {!carregandoItens && itensPdm.length === 0 && (
              <div className="p-6 text-center text-xs text-gray-400">
                Nenhum item CATMAT cadastrado nesse PDM.
              </div>
            )}

            {itensPdm.map(item => (
              <button
                key={item.codigoItem}
                type="button"
                onClick={() => aplicarItem(item, pdmSelecionado)}
                className="w-full text-left p-3 hover:bg-green-50 transition flex items-start gap-3 group"
              >
                <div className="font-mono text-[10px] font-bold text-amber-700 bg-amber-100 border border-amber-200 px-1.5 py-0.5 rounded shrink-0 mt-0.5">
                  {item.codigoItem}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-gray-700 leading-snug">
                    {formatarCaracteristicas(item) || item.descricaoCompleta || '(sem características)'}
                  </div>
                  {item.unidadeFornecimento && (
                    <div className="text-[10px] text-gray-500 mt-0.5">
                      Unidade: {item.unidadeFornecimento}
                    </div>
                  )}
                </div>
                <CheckCircle2 className="w-4 h-4 text-green-500 opacity-0 group-hover:opacity-100 shrink-0 mt-0.5" />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
