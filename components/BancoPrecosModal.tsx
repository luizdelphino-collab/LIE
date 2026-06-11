/**
 * Modal de importação de pesquisa de preços do Banco de Preços (BP4).
 * Fluxo de seleção MANUAL: cotação existente -> item da cotação -> anexa ao
 * ItemMaster do LIE (gera PDF-snapshot + grava referências/média/mediana).
 */
import { useEffect, useState } from 'react';
import { X, Loader2, Landmark, ChevronRight, Search, FileText, CheckCircle2 } from 'lucide-react';
import type { ItemMaster } from '../types';
import {
  listarCotacoes, listarItens, listarPrecos, anexarPrecosAoItem,
  type BpCotacao, type BpItem, type BpPreco,
} from '../lib/bancoDePrecos';

interface Props {
  item: ItemMaster;
  onClose: () => void;
  onComplete: () => void;
}

const brl = (n: number) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function BancoPrecosModal({ item, onClose, onComplete }: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [erro, setErro] = useState<string | null>(null);

  const [cotacoes, setCotacoes] = useState<BpCotacao[]>([]);
  const [carregandoCot, setCarregandoCot] = useState(false);
  const [filtro, setFiltro] = useState('');
  const [cotacao, setCotacao] = useState<BpCotacao | null>(null);

  const [itens, setItens] = useState<BpItem[]>([]);
  const [carregandoItens, setCarregandoItens] = useState(false);
  const [bpItem, setBpItem] = useState<BpItem | null>(null);

  const [precos, setPrecos] = useState<BpPreco[]>([]);
  const [carregandoPrecos, setCarregandoPrecos] = useState(false);

  const [salvando, setSalvando] = useState(false);
  const [sucesso, setSucesso] = useState<{ refs: number; media: number; mediana: number } | null>(null);

  // Passo 1 — carrega cotações da conta.
  useEffect(() => {
    let vivo = true;
    setCarregandoCot(true);
    setErro(null);
    listarCotacoes()
      .then(c => { if (vivo) setCotacoes(c); })
      .catch(e => { if (vivo) setErro(e.message); })
      .finally(() => { if (vivo) setCarregandoCot(false); });
    return () => { vivo = false; };
  }, []);

  async function abrirCotacao(c: BpCotacao) {
    setCotacao(c);
    setStep(2);
    setItens([]);
    setBpItem(null);
    setErro(null);
    setCarregandoItens(true);
    try {
      setItens(await listarItens(c.idCotacao));
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setCarregandoItens(false);
    }
  }

  async function abrirItem(it: BpItem) {
    if (!cotacao) return;
    setBpItem(it);
    setStep(3);
    setPrecos([]);
    setErro(null);
    setCarregandoPrecos(true);
    try {
      setPrecos(await listarPrecos(cotacao.idCotacao, it.idItem));
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setCarregandoPrecos(false);
    }
  }

  async function confirmarAnexo() {
    if (!cotacao || !bpItem) return;
    setSalvando(true);
    setErro(null);
    try {
      const r = await anexarPrecosAoItem(item, cotacao, bpItem.idItem, precos);
      setSucesso({ refs: r.refs, media: r.media, mediana: r.mediana });
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setSalvando(false);
    }
  }

  const cotacoesFiltradas = cotacoes.filter(c =>
    !filtro.trim() || (c.descricao || '').toLowerCase().includes(filtro.toLowerCase()) || String(c.idCotacao).includes(filtro)
  );
  const considerados = precos.filter(p => !p.isDesconsideradoDoCalculo && Number(p.preco) > 0).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[88vh] flex flex-col">
        {/* Cabeçalho */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="flex items-center gap-2 min-w-0">
            <Landmark className="w-5 h-5 text-lie-green shrink-0" />
            <div className="min-w-0">
              <h2 className="font-bold text-lie-ink truncate">Banco de Preços — {item.nome}</h2>
              <p className="text-xs text-gray-500">
                Passo {step} de 3 · {step === 1 ? 'escolha a cotação' : step === 2 ? 'escolha o item da cotação' : 'confira e anexe os preços'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:bg-gray-100 rounded transition shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Trilha (breadcrumb) */}
        <div className="flex items-center gap-1 px-5 py-2 text-xs text-gray-500 border-b bg-gray-50">
          <button onClick={() => { setStep(1); setCotacao(null); setBpItem(null); }} className={step === 1 ? 'font-semibold text-lie-green' : 'hover:underline'}>
            Cotações
          </button>
          {cotacao && <><ChevronRight className="w-3 h-3" /><button onClick={() => setStep(2)} className={step === 2 ? 'font-semibold text-lie-green' : 'hover:underline truncate max-w-[200px]'}>{cotacao.descricao}</button></>}
          {bpItem && <><ChevronRight className="w-3 h-3" /><span className="font-semibold text-lie-green truncate max-w-[200px]">{bpItem.nome || `Item ${bpItem.idItem}`}</span></>}
        </div>

        {/* Corpo */}
        <div className="flex-1 overflow-y-auto p-5">
          {erro && (
            <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded">
              {erro}
            </div>
          )}

          {/* SUCESSO */}
          {sucesso ? (
            <div className="text-center py-8">
              <CheckCircle2 className="w-12 h-12 text-lie-green mx-auto mb-3" />
              <h3 className="font-bold text-lie-ink text-lg">Preços anexados!</h3>
              <p className="text-sm text-gray-600 mt-1">
                {sucesso.refs} referência(s) importada(s) · PDF-snapshot anexado ao item.
              </p>
              <p className="text-sm text-gray-700 mt-2">
                Média <strong>{brl(sucesso.media)}</strong> · Mediana <strong>{brl(sucesso.mediana)}</strong>
              </p>
              <button onClick={onComplete} className="mt-5 px-4 py-2 bg-lie-green text-white rounded-lg font-semibold hover:bg-lie-greenDark transition">
                Concluir
              </button>
            </div>
          ) : (
            <>
              {/* PASSO 1 — cotações */}
              {step === 1 && (
                <div>
                  <div className="relative mb-3">
                    <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      value={filtro}
                      onChange={e => setFiltro(e.target.value)}
                      placeholder="Filtrar cotações por descrição ou id…"
                      className="w-full pl-9 pr-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-lie-green/30 outline-none"
                    />
                  </div>
                  {carregandoCot ? (
                    <div className="flex items-center justify-center py-10 text-gray-500"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando cotações…</div>
                  ) : cotacoesFiltradas.length === 0 ? (
                    <p className="text-center text-sm text-gray-500 py-10">Nenhuma cotação encontrada.</p>
                  ) : (
                    <ul className="divide-y border rounded-lg">
                      {cotacoesFiltradas.map(c => (
                        <li key={c.idCotacao}>
                          <button onClick={() => abrirCotacao(c)} className="w-full flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-lie-green/5 transition text-left">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-lie-ink truncate">{c.descricao || `Cotação ${c.idCotacao}`}</p>
                              <p className="text-xs text-gray-500">
                                id {c.idCotacao}{c.quantidadeItens != null ? ` · ${c.quantidadeItens} itens` : ''}{c.finalizada ? ' · finalizada' : ''}
                              </p>
                            </div>
                            <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* PASSO 2 — itens da cotação */}
              {step === 2 && (
                carregandoItens ? (
                  <div className="flex items-center justify-center py-10 text-gray-500"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando itens…</div>
                ) : itens.length === 0 ? (
                  <p className="text-center text-sm text-gray-500 py-10">Esta cotação não possui itens.</p>
                ) : (
                  <ul className="divide-y border rounded-lg">
                    {itens.map(it => (
                      <li key={it.idItem}>
                        <button onClick={() => abrirItem(it)} disabled={!it.countPrecos} className="w-full flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-lie-green/5 transition text-left disabled:opacity-40 disabled:cursor-not-allowed">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-lie-ink truncate">{it.nome || `Item ${it.idItem}`}</p>
                            <p className="text-xs text-gray-500 truncate">
                              {it.nomeLote ? `${it.nomeLote} · ` : ''}{it.countPrecos} preço(s){it.unidade ? ` · ${it.unidade}` : ''}
                            </p>
                          </div>
                          <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              )}

              {/* PASSO 3 — preços do item */}
              {step === 3 && (
                carregandoPrecos ? (
                  <div className="flex items-center justify-center py-10 text-gray-500"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando preços…</div>
                ) : precos.length === 0 ? (
                  <p className="text-center text-sm text-gray-500 py-10">Nenhum preço pesquisado neste item.</p>
                ) : (
                  <div>
                    <p className="text-xs text-gray-600 mb-2">
                      {considerados} de {precos.length} preço(s) serão importados (desconsiderados do cálculo são ignorados).
                    </p>
                    <div className="overflow-x-auto border rounded-lg">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 text-gray-600">
                          <tr>
                            <th className="text-left px-2 py-1.5 font-semibold">Fonte</th>
                            <th className="text-left px-2 py-1.5 font-semibold">Fornecedor</th>
                            <th className="text-left px-2 py-1.5 font-semibold">UF</th>
                            <th className="text-left px-2 py-1.5 font-semibold">Data</th>
                            <th className="text-right px-2 py-1.5 font-semibold">Valor</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {precos.map((p, i) => (
                            <tr key={i} className={p.isDesconsideradoDoCalculo ? 'text-gray-400 line-through' : 'text-lie-ink'}>
                              <td className="px-2 py-1.5 truncate max-w-[140px]">{p.fontePesquisa || '—'}</td>
                              <td className="px-2 py-1.5 truncate max-w-[140px]">{p.cnpjFornecedor || '—'}</td>
                              <td className="px-2 py-1.5">{p.uf || '—'}</td>
                              <td className="px-2 py-1.5">{(p.dataHomologacao || p.data || '').slice(0, 10)}</td>
                              <td className="px-2 py-1.5 text-right font-medium">{brl(Number(p.preco) || 0)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              )}
            </>
          )}
        </div>

        {/* Rodapé (ação do passo 3) */}
        {!sucesso && step === 3 && precos.length > 0 && (
          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t">
            <button onClick={() => setStep(2)} className="px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition">Voltar</button>
            <button
              onClick={confirmarAnexo}
              disabled={salvando || considerados === 0}
              className="flex items-center gap-2 px-4 py-2 bg-lie-green text-white rounded-lg font-semibold hover:bg-lie-greenDark transition disabled:opacity-50"
            >
              {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
              {salvando ? 'Anexando…' : `Anexar ${considerados} preço(s) + PDF`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
