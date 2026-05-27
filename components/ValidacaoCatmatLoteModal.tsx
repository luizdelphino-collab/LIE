import { useState } from 'react';
import {
  X, Loader2, CheckCircle2, AlertCircle, AlertTriangle, Wand2,
  Package, Wrench, ExternalLink, Search
} from 'lucide-react';
import { writeBatch, doc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { sugerirMelhorMatch, listarItensDoPdm, formatarCaracteristicas, type ItemDoPdm } from '../lib/catalogoApi';
import type { ItemMaster } from '../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  items: ItemMaster[];
  onAtualizado: () => void;
}

type StatusSugestao = 'pendente' | 'processando' | 'ok' | 'sem-match' | 'erro' | 'aceito' | 'recusado';

interface SugestaoLinha {
  itemId: string;
  itemNome: string;
  status: StatusSugestao;
  tipo?: 'material' | 'servico';
  codigoPdm?: number;
  nomePdm?: string;
  codigoServico?: number;
  nomeServico?: string;
  score?: number;
  classe?: string;
  grupo?: string;
  // Se material, depois de aceitar, precisa escolher o item dentro do PDM
  itemPdmEscolhido?: ItemDoPdm;
  itensDoPdm?: ItemDoPdm[];
  carregandoItens?: boolean;
}

const CONCURRENT = 4;
const SCORE_AUTO_ACEITO = 0.85;
const SCORE_BOM = 0.55;

export default function ValidacaoCatmatLoteModal({ isOpen, onClose, items, onAtualizado }: Props) {
  const [processando, setProcessando] = useState(false);
  const [progresso, setProgresso] = useState({ done: 0, total: 0 });
  const [sugestoes, setSugestoes] = useState<SugestaoLinha[]>([]);
  const [aplicando, setAplicando] = useState(false);
  const [aplicado, setAplicado] = useState<number | null>(null);

  if (!isOpen) return null;

  const itensSemCatmat = items.filter(it => !it.codigoCatmat);

  const iniciarProcessamento = async () => {
    setProcessando(true);
    setProgresso({ done: 0, total: itensSemCatmat.length });
    setSugestoes(itensSemCatmat.map(it => ({
      itemId: it.id, itemNome: it.nome, status: 'pendente'
    })));

    let cursor = 0;
    const updateLinha = (id: string, patch: Partial<SugestaoLinha>) => {
      setSugestoes(prev => prev.map(l => l.itemId === id ? { ...l, ...patch } : l));
    };

    const processarUm = async (it: ItemMaster) => {
      updateLinha(it.id, { status: 'processando' });
      try {
        const match = await sugerirMelhorMatch(it.nome);
        if (!match || match.score < 0.3) {
          updateLinha(it.id, { status: 'sem-match' });
          return;
        }
        const statusAuto: StatusSugestao = match.score >= SCORE_AUTO_ACEITO ? 'aceito' : 'ok';
        updateLinha(it.id, {
          status: statusAuto,
          tipo: match.tipo,
          codigoPdm: match.codigoPdm,
          nomePdm: match.nomePdm,
          codigoServico: match.codigoServico,
          nomeServico: match.nomeServico,
          score: match.score,
          classe: match.classe,
          grupo: match.grupo
        });

        // Pra material, já busca itens do PDM em background pra acelerar
        if (match.tipo === 'material' && match.codigoPdm) {
          listarItensDoPdm(match.codigoPdm).then(itens => {
            updateLinha(it.id, {
              itensDoPdm: itens,
              itemPdmEscolhido: itens[0] // default: primeiro item
            });
          });
        }
      } catch (e: any) {
        console.error('Erro pesquisando', it.nome, e);
        updateLinha(it.id, { status: 'erro' });
      } finally {
        setProgresso(p => ({ ...p, done: p.done + 1 }));
      }
    };

    const runner = async () => {
      while (cursor < itensSemCatmat.length) {
        const i = cursor++;
        await processarUm(itensSemCatmat[i]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENT, itensSemCatmat.length) }, () => runner()));
    setProcessando(false);
  };

  const toggleStatus = (id: string, novo: StatusSugestao) => {
    setSugestoes(prev => prev.map(l => l.itemId === id ? { ...l, status: novo } : l));
  };

  const escolherItemPdm = (id: string, itemPdm: ItemDoPdm) => {
    setSugestoes(prev => prev.map(l => l.itemId === id ? { ...l, itemPdmEscolhido: itemPdm } : l));
  };

  const aplicarAceitos = async () => {
    const aceitos = sugestoes.filter(l => l.status === 'aceito');
    if (aceitos.length === 0) {
      alert('Marque pelo menos uma sugestão como "Aceita".');
      return;
    }
    if (!confirm(`Aplicar CATMAT/CATSER em ${aceitos.length} item(ns)? Os campos do banco serão atualizados.`)) return;

    setAplicando(true);
    try {
      // Particiona em batches de 400 (Firestore limit é 500)
      for (let i = 0; i < aceitos.length; i += 400) {
        const batch = writeBatch(db);
        for (const linha of aceitos.slice(i, i + 400)) {
          if (linha.tipo === 'material') {
            const itemPdm = linha.itemPdmEscolhido;
            if (!itemPdm || !linha.codigoPdm) continue;
            batch.set(doc(db, 'items', linha.itemId), {
              codigoCatmat: itemPdm.codigoItem,
              tipoCatmat: 'material',
              nomeCatmatOficial: linha.nomePdm,
              descricaoCatmatOficial: formatarCaracteristicas(itemPdm) || linha.nomePdm
            }, { merge: true });
          } else if (linha.tipo === 'servico' && linha.codigoServico) {
            batch.set(doc(db, 'items', linha.itemId), {
              codigoCatmat: linha.codigoServico,
              tipoCatmat: 'servico',
              nomeCatmatOficial: linha.nomeServico,
              descricaoCatmatOficial: linha.nomeServico
            }, { merge: true });
          }
        }
        await batch.commit();
      }
      setAplicado(aceitos.length);
      onAtualizado();
    } catch (e: any) {
      alert(`Erro ao aplicar: ${e?.message || e}`);
    } finally {
      setAplicando(false);
    }
  };

  const contadores = {
    aceito: sugestoes.filter(s => s.status === 'aceito').length,
    ok: sugestoes.filter(s => s.status === 'ok').length,
    recusado: sugestoes.filter(s => s.status === 'recusado').length,
    semMatch: sugestoes.filter(s => s.status === 'sem-match').length,
    erro: sugestoes.filter(s => s.status === 'erro').length
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden animate-zoom-in">
        <header className="bg-lie-ink p-4 flex items-center justify-between text-white">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-500 rounded-lg">
              <Wand2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-bold">Validação Automática de CATMAT/CATSER em Lote</h3>
              <p className="text-xs text-gray-300">
                {sugestoes.length === 0
                  ? `${itensSemCatmat.length} item(ns) sem CATMAT/CATSER no banco`
                  : processando
                    ? `Processando ${progresso.done} / ${progresso.total}…`
                    : aplicado !== null
                      ? `Concluído: ${aplicado} item(ns) atualizado(s).`
                      : `Revise as sugestões e marque quais aplicar`}
              </p>
            </div>
          </div>
          {!processando && !aplicando && (
            <button onClick={onClose} className="hover:bg-white/10 p-2 rounded-full">
              <X className="w-5 h-5" />
            </button>
          )}
        </header>

        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {/* Tela inicial */}
          {sugestoes.length === 0 && !processando && (
            <>
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-900 leading-relaxed flex gap-3">
                <AlertCircle className="w-5 h-5 shrink-0 text-amber-600 mt-0.5" />
                <div>
                  <strong className="block text-sm mb-1">Como funciona:</strong>
                  Pra cada item sem CATMAT, busca a melhor sugestão no catálogo Compras.gov.br
                  por similaridade textual. Sugestões com score ≥ 85% são pré-aceitas
                  (verde); abaixo disso ficam neutras (azul) pra você revisar e decidir.
                  Itens sem nenhum match aparecem como "sem-match" e ficam pra cadastro manual.
                  <strong className="block mt-2">Nada é salvo até você clicar "Aplicar"</strong> no final.
                </div>
              </div>

              {itensSemCatmat.length === 0 ? (
                <div className="text-center py-8 text-green-700 bg-green-50 border border-green-200 rounded-xl">
                  <CheckCircle2 className="w-10 h-10 mx-auto mb-2 text-green-600" />
                  <p className="font-bold">Todos os itens já têm CATMAT/CATSER cadastrado!</p>
                </div>
              ) : (
                <div className="flex justify-center">
                  <button
                    onClick={iniciarProcessamento}
                    className="px-6 py-3 bg-amber-500 text-white font-bold rounded-lg hover:bg-amber-600 transition flex items-center gap-2 shadow"
                  >
                    <Search className="w-5 h-5" />
                    Iniciar busca em {itensSemCatmat.length} item(ns)
                  </button>
                </div>
              )}
            </>
          )}

          {/* Progresso */}
          {processando && (
            <div className="space-y-2">
              <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-amber-500 h-full transition-all"
                  style={{ width: `${(progresso.done / progresso.total) * 100}%` }}
                />
              </div>
              <p className="text-xs text-gray-500 flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Consultando catálogo Compras.gov.br…
              </p>
            </div>
          )}

          {/* Resumo + tabela de sugestões */}
          {sugestoes.length > 0 && !processando && aplicado === null && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                <div className="bg-green-50 border border-green-200 rounded-lg p-2 text-center">
                  <div className="text-2xl font-bold text-green-700">{contadores.aceito}</div>
                  <div className="text-green-800 font-bold">Pré-aceitos</div>
                </div>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-2 text-center">
                  <div className="text-2xl font-bold text-blue-700">{contadores.ok}</div>
                  <div className="text-blue-800 font-bold">Revisar</div>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-2 text-center">
                  <div className="text-2xl font-bold text-gray-700">{contadores.recusado}</div>
                  <div className="text-gray-700 font-bold">Recusados</div>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-center">
                  <div className="text-2xl font-bold text-amber-700">{contadores.semMatch}</div>
                  <div className="text-amber-800 font-bold">Sem match</div>
                </div>
                <div className="bg-red-50 border border-red-200 rounded-lg p-2 text-center">
                  <div className="text-2xl font-bold text-red-700">{contadores.erro}</div>
                  <div className="text-red-800 font-bold">Erros</div>
                </div>
              </div>

              <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
                {sugestoes.map(s => (
                  <SugestaoCard
                    key={s.itemId}
                    linha={s}
                    onToggleStatus={novo => toggleStatus(s.itemId, novo)}
                    onEscolherItemPdm={item => escolherItemPdm(s.itemId, item)}
                  />
                ))}
              </div>
            </>
          )}

          {/* Sucesso */}
          {aplicado !== null && (
            <div className="text-center py-8 text-green-700 bg-green-50 border border-green-200 rounded-xl">
              <CheckCircle2 className="w-10 h-10 mx-auto mb-2 text-green-600" />
              <p className="font-bold">{aplicado} item(ns) atualizado(s) com CATMAT/CATSER oficial!</p>
              <p className="text-xs text-green-600 mt-1">
                Agora os itens entram na Pesquisa Automática de Preços com códigos válidos.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        {sugestoes.length > 0 && !processando && aplicado === null && (
          <div className="p-4 bg-gray-50 border-t flex justify-end gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 font-bold text-gray-600 hover:bg-gray-100 rounded-lg"
            >
              Cancelar
            </button>
            <button
              onClick={aplicarAceitos}
              disabled={aplicando || contadores.aceito === 0}
              className="px-6 py-2 bg-lie-green text-white font-bold rounded-lg hover:bg-lie-greenDark transition flex items-center gap-2 disabled:opacity-50"
            >
              {aplicando ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {aplicando ? 'Aplicando…' : `Aplicar em ${contadores.aceito} item(ns) aceitos`}
            </button>
          </div>
        )}

        {aplicado !== null && (
          <div className="p-4 bg-gray-50 border-t flex justify-end">
            <button
              onClick={onClose}
              className="px-6 py-2 bg-lie-green text-white font-bold rounded-lg hover:bg-lie-greenDark"
            >
              Fechar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// === Card de cada sugestão ===

interface CardProps {
  linha: SugestaoLinha;
  onToggleStatus: (novo: StatusSugestao) => void;
  onEscolherItemPdm: (item: ItemDoPdm) => void;
}

function SugestaoCard({ linha, onToggleStatus, onEscolherItemPdm }: CardProps) {
  const [expandido, setExpandido] = useState(false);

  const statusColors: Record<StatusSugestao, string> = {
    'pendente': 'bg-gray-50 border-gray-200',
    'processando': 'bg-blue-50 border-blue-200',
    'ok': 'bg-blue-50 border-blue-200',
    'aceito': 'bg-green-50 border-green-300',
    'recusado': 'bg-gray-50 border-gray-200 opacity-60',
    'sem-match': 'bg-amber-50 border-amber-200',
    'erro': 'bg-red-50 border-red-200'
  };

  const scorePct = linha.score ? Math.round(linha.score * 100) : 0;
  const scoreColor = scorePct >= 85 ? 'text-green-700' : scorePct >= 55 ? 'text-blue-700' : 'text-amber-700';
  const nomeSugestao = linha.tipo === 'material' ? linha.nomePdm : linha.nomeServico;
  const codigoSugestao = linha.tipo === 'material' ? linha.codigoPdm : linha.codigoServico;

  return (
    <div className={`border rounded-lg p-3 ${statusColors[linha.status]}`}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-sm text-lie-ink">{linha.itemNome}</span>
            {linha.status === 'aceito' && <span className="text-[10px] uppercase font-bold text-green-700 bg-green-100 px-1.5 py-0.5 rounded">Aceito</span>}
            {linha.status === 'ok' && <span className="text-[10px] uppercase font-bold text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded">Revisar</span>}
            {linha.status === 'recusado' && <span className="text-[10px] uppercase font-bold text-gray-700 bg-gray-200 px-1.5 py-0.5 rounded">Recusado</span>}
            {linha.status === 'sem-match' && <span className="text-[10px] uppercase font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">Sem match</span>}
            {linha.status === 'erro' && <span className="text-[10px] uppercase font-bold text-red-700 bg-red-100 px-1.5 py-0.5 rounded">Erro</span>}
            {linha.status === 'processando' && <Loader2 className="w-3.5 h-3.5 text-blue-600 animate-spin" />}
            {linha.score !== undefined && (
              <span className={`text-[10px] font-mono font-bold ${scoreColor}`}>
                {scorePct}%
              </span>
            )}
          </div>

          {/* Sugestão */}
          {(linha.status === 'ok' || linha.status === 'aceito' || linha.status === 'recusado') && nomeSugestao && (
            <div className="mt-1.5 text-xs text-gray-700">
              <div className="flex items-center gap-1.5">
                {linha.tipo === 'material' ? <Package className="w-3.5 h-3.5 text-amber-600" /> : <Wrench className="w-3.5 h-3.5 text-amber-600" />}
                <span className="font-mono text-[10px] font-bold text-gray-500 bg-white border border-gray-200 px-1.5 py-0.5 rounded">
                  {linha.tipo === 'material' ? `PDM ${codigoSugestao}` : `CATSER ${codigoSugestao}`}
                </span>
                <span className="font-bold">{nomeSugestao}</span>
              </div>
              {(linha.classe || linha.grupo) && (
                <div className="text-[10px] text-gray-500 mt-0.5">
                  {linha.classe && <span>Classe: {linha.classe}</span>}
                  {linha.grupo && <span> • {linha.grupo}</span>}
                </div>
              )}

              {/* Pra material: mostra item escolhido + permite trocar */}
              {linha.tipo === 'material' && linha.itensDoPdm && (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => setExpandido(!expandido)}
                    className="text-[10px] text-blue-600 hover:underline font-bold"
                  >
                    {expandido ? '▲ Esconder' : `▼ Escolher item específico (${linha.itensDoPdm.length} disponíveis)`}
                  </button>
                  {linha.itemPdmEscolhido && !expandido && (
                    <div className="text-[10px] text-gray-600 mt-1 italic">
                      Item selecionado: <strong>{linha.itemPdmEscolhido.codigoItem}</strong> — {formatarCaracteristicas(linha.itemPdmEscolhido) || '(sem características)'}
                    </div>
                  )}
                  {expandido && (
                    <div className="mt-2 max-h-40 overflow-y-auto border border-gray-200 rounded bg-white divide-y divide-gray-100">
                      {linha.itensDoPdm.map(it => (
                        <button
                          key={it.codigoItem}
                          type="button"
                          onClick={() => { onEscolherItemPdm(it); setExpandido(false); }}
                          className={`w-full text-left p-2 text-[11px] hover:bg-green-50 transition flex items-start gap-2 ${
                            linha.itemPdmEscolhido?.codigoItem === it.codigoItem ? 'bg-green-50' : ''
                          }`}
                        >
                          <span className="font-mono font-bold text-amber-700 text-[10px]">{it.codigoItem}</span>
                          <span className="flex-1">{formatarCaracteristicas(it) || '(sem características)'}</span>
                          {linha.itemPdmEscolhido?.codigoItem === it.codigoItem && <CheckCircle2 className="w-3.5 h-3.5 text-green-600 shrink-0" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {linha.status === 'sem-match' && (
            <div className="mt-1 text-xs text-amber-800">
              Nenhum match suficiente no catálogo. Cadastre manualmente via "Editar item".
            </div>
          )}
        </div>

        {/* Botões */}
        {(linha.status === 'ok' || linha.status === 'aceito' || linha.status === 'recusado') && (
          <div className="flex gap-1 shrink-0">
            <button
              onClick={() => onToggleStatus(linha.status === 'aceito' ? 'ok' : 'aceito')}
              title={linha.status === 'aceito' ? 'Desaceitar' : 'Aceitar'}
              className={`p-2 rounded transition ${
                linha.status === 'aceito'
                  ? 'bg-green-600 text-white hover:bg-green-700'
                  : 'bg-white border border-gray-300 text-gray-600 hover:bg-green-50 hover:border-green-300'
              }`}
            >
              <CheckCircle2 className="w-4 h-4" />
            </button>
            <button
              onClick={() => onToggleStatus(linha.status === 'recusado' ? 'ok' : 'recusado')}
              title={linha.status === 'recusado' ? 'Desfazer recusa' : 'Recusar'}
              className={`p-2 rounded transition ${
                linha.status === 'recusado'
                  ? 'bg-gray-600 text-white hover:bg-gray-700'
                  : 'bg-white border border-gray-300 text-gray-600 hover:bg-red-50 hover:border-red-300'
              }`}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {linha.status === 'sem-match' && (
          <a
            href={`https://catalogo.compras.gov.br/cnbs-web/busca?palavraChave=${encodeURIComponent(linha.itemNome)}`}
            target="_blank"
            rel="noopener noreferrer"
            title="Buscar manualmente no catálogo"
            className="p-2 bg-white border border-amber-300 text-amber-700 rounded hover:bg-amber-50 transition shrink-0"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        )}
      </div>
    </div>
  );
}
