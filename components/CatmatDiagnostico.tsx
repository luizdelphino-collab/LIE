/**
 * components/CatmatDiagnostico.tsx
 *
 * Painel de status de cobertura CATMAT para o Banco de Dados de Itens.
 * Exibe: quantos itens têm CATMAT vinculado, quantos não têm, e botão
 * para vincular em lote via seed local.
 *
 * Inclui lógica de "vincular automático via seed" diretamente no componente
 * — sem precisar rodar script externo. Usa a mesma lógica do seed-catmat-firestore.ts
 * mas roda no browser com Firestore SDK.
 */

import { useState } from 'react';
import { doc, writeBatch } from 'firebase/firestore';
import { ShieldCheck, ShieldAlert, Wand2, Loader2, X, CheckCircle2, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { db } from '../lib/firebase';
import type { ItemMaster } from '../types';
import { listarTodosSeedLocal } from '../lib/apiCompras';

interface Props {
  items: ItemMaster[];
  onAtualizado: () => void;
}

interface ResultadoVinculacao {
  nome: string;
  codigoCatmat: number;
  nomeCatmat: string;
  metodo: string;
}

function norm(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function diceScore(a: string, b: string): number {
  const na = norm(a); const nb = norm(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.length < 2 || nb.length < 2) return 0;
  const bi = (s: string) => { const r = new Set<string>(); for (let i=0;i<s.length-1;i++) r.add(s.slice(i,i+2)); return r; };
  const sa = bi(na); const sb = bi(nb);
  let inter = 0; sa.forEach(b => { if (sb.has(b)) inter++; });
  return (2 * inter) / (sa.size + sb.size);
}

export default function CatmatDiagnostico({ items, onAtualizado }: Props) {
  const [rodando, setRodando] = useState(false);
  const [resultados, setResultados] = useState<ResultadoVinculacao[]>([]);
  const [semMatch, setSemMatch] = useState<string[]>([]);
  const [concluido, setConcluido] = useState(false);
  const [expandido, setExpandido] = useState(false);

  // Itens em rota legal alternativa (3 orcamentos) NAO precisam de CATMAT.
  // Eles sao excluidos da cobertura porque ja estao atendidos por outro caminho legal.
  const itensQuePrecisamCatmat = items.filter(it => !it.semCorrespondenciaCatalogo);
  const itensRotaAlternativa = items.filter(it => it.semCorrespondenciaCatalogo);
  const comCatmat = itensQuePrecisamCatmat.filter(it => it.codigoCatmat && it.codigoCatmat > 0);
  const semCatmat = itensQuePrecisamCatmat.filter(it => !it.codigoCatmat || it.codigoCatmat === 0);
  const cobertura = itensQuePrecisamCatmat.length > 0 ? Math.round((comCatmat.length / itensQuePrecisamCatmat.length) * 100) : 100;

  const seed = listarTodosSeedLocal() as any[];

  function encontrarMatch(nomeItem: string) {
    const nomeNorm = norm(nomeItem);
    const palavras = nomeNorm.split(/\s+/).filter(p => p.length >= 3);
    let melhor: { seed: any; score: number; metodo: string } | null = null;

    for (const s of seed) {
      const aliases = [s.nome, ...(s.nomesAlternativos || [])].map(norm);
      const textoCombinado = aliases.join(' ') + ' ' + norm(s.descricaoItem);

      if (aliases.some(a => a === nomeNorm || a.includes(nomeNorm) || nomeNorm.includes(a))) {
        return { seed: s, score: 0.95, metodo: 'exato' };
      }
      if (palavras.length >= 2 && palavras.every(p => textoCombinado.includes(p))) {
        if (!melhor || 0.85 > melhor.score) melhor = { seed: s, score: 0.85, metodo: 'palavras' };
        continue;
      }
      const maxDice = Math.max(...aliases.map(a => diceScore(nomeItem, a)));
      if (maxDice >= 0.6 && (!melhor || maxDice > melhor.score)) {
        melhor = { seed: s, score: maxDice, metodo: 'dice' };
      }
    }
    return melhor;
  }

  const vincularEmLote = async () => {
    if (semCatmat.length === 0) return;
    setRodando(true);
    setConcluido(false);
    setResultados([]);
    setSemMatch([]);

    const vinculados: ResultadoVinculacao[] = [];
    const naoEncontrados: string[] = [];

    // Processa em lotes de 450 (limite do Firestore batch = 500)
    const chunks: ItemMaster[][] = [];
    for (let i = 0; i < semCatmat.length; i += 450) {
      chunks.push(semCatmat.slice(i, i + 450));
    }

    for (const chunk of chunks) {
      const batch = writeBatch(db);

      for (const item of chunk) {
        const match = encontrarMatch(item.nome);
        if (!match) {
          naoEncontrados.push(item.nome);
          continue;
        }
        const s = match.seed;
        batch.update(doc(db, 'items', item.id), {
          codigoCatmat: s.codigoItem,
          tipoCatmat: s.tipo || 'material',
          nomeCatmatOficial: s.nome,
          descricaoCatmatOficial: s.descricaoItem,
        });
        vinculados.push({
          nome: item.nome,
          codigoCatmat: s.codigoItem,
          nomeCatmat: s.nome,
          metodo: match.metodo,
        });
      }

      await batch.commit();
    }

    setResultados(vinculados);
    setSemMatch(naoEncontrados);
    setConcluido(true);
    setRodando(false);
    onAtualizado();
  };

  if (cobertura === 100 && !concluido) return null;

  return (
    <div className="mb-4 rounded-xl border border-gray-200 overflow-hidden">
      {/* Barra de status */}
      <div
        className="flex items-center justify-between px-4 py-3 bg-white cursor-pointer hover:bg-gray-50"
        onClick={() => setExpandido(e => !e)}
      >
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-600" />
            <span className="text-sm font-semibold text-gray-700">
              Cobertura CATMAT: <span className={cobertura >= 80 ? 'text-emerald-600' : cobertura >= 50 ? 'text-amber-600' : 'text-red-600'}>{cobertura}%</span>
            </span>
          </div>

          {/* Barra de progresso */}
          <div className="w-32 h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${cobertura >= 80 ? 'bg-emerald-500' : cobertura >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}
              style={{ width: `${cobertura}%` }}
            />
          </div>

          <span className="text-xs text-gray-500">
            {comCatmat.length} com CATMAT · {semCatmat.length} sem CATMAT
            {itensRotaAlternativa.length > 0 && <> · <span className="text-purple-700">{itensRotaAlternativa.length} em rota alternativa (3 orçamentos)</span></>}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {semCatmat.length > 0 && !rodando && (
            <button
              onClick={e => { e.stopPropagation(); vincularEmLote(); }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-xs font-semibold rounded-lg hover:bg-emerald-700 transition-colors"
            >
              <Wand2 className="w-3.5 h-3.5" />
              Vincular {semCatmat.length} automaticamente
            </button>
          )}
          {rodando && (
            <span className="flex items-center gap-1.5 text-xs text-gray-500">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Vinculando...
            </span>
          )}
          {expandido ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </div>
      </div>

      {/* Painel expandido com resultados */}
      {expandido && (
        <div className="border-t border-gray-100 bg-gray-50 px-4 py-3">

          {/* Lista de itens sem CATMAT */}
          {!concluido && semCatmat.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-600 mb-2 flex items-center gap-1">
                <ShieldAlert className="w-3.5 h-3.5 text-amber-500" />
                Itens sem CATMAT ({semCatmat.length}) — sem dados de preço de mercado:
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-1">
                {semCatmat.map(it => (
                  <div key={it.id} className="text-xs text-gray-600 bg-white border border-gray-200 rounded px-2 py-1 truncate">
                    #{it.codigo} {it.nome}
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Clique em <strong>Vincular automaticamente</strong> para tentar associar CATMATs via catálogo local.
                Para itens sem correspondência, edite manualmente no formulário do item.
              </p>
            </div>
          )}

          {/* Resultado da vinculação */}
          {concluido && (
            <div className="space-y-3">
              {resultados.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-emerald-700 mb-1 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {resultados.length} itens vinculados com sucesso:
                  </p>
                  <div className="space-y-0.5 max-h-40 overflow-y-auto">
                    {resultados.map((r, i) => (
                      <div key={i} className="text-xs text-gray-600 flex items-center gap-2">
                        <span className="font-mono text-emerald-600">{r.codigoCatmat}</span>
                        <span className="text-gray-400">←</span>
                        <span>{r.nome}</span>
                        <span className="text-gray-400 text-[10px]">({r.metodo})</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {semMatch.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-amber-700 mb-1 flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {semMatch.length} itens sem correspondência no catálogo local:
                  </p>
                  <div className="space-y-0.5">
                    {semMatch.map((nome, i) => (
                      <div key={i} className="text-xs text-gray-500">
                        • {nome} → <span className="text-amber-600">editar manualmente</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    Para estes itens: edite → use o buscador do Catálogo Compras.gov.br → salve o código.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
