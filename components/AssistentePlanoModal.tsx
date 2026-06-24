/**
 * components/AssistentePlanoModal.tsx
 *
 * Assistente de Plano de Trabalho com IA (Fase A — campos narrativos).
 * Coleta um brief curto + puxa o histórico da entidade, chama o Gemini e
 * preenche resumo, objetivo geral, objetivos específicos, justificativa,
 * caracterização socioeconômica e metodologia. O usuário revisa antes de aplicar.
 */

import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { Sparkles, X, Loader2, CheckCircle2, Building2, AlertTriangle, Wand2 } from 'lucide-react';
import { db } from '../lib/firebase';
import type { Projeto } from '../types';
import { gerarPlanoComIA, type PlanoIaNarrativo } from '../lib/planoIaApi';

interface Props {
  projeto: Partial<Projeto>;
  onClose: () => void;
  onApply: (narrativo: PlanoIaNarrativo) => void;
}

export default function AssistentePlanoModal({ projeto, onClose, onApply }: Props) {
  const [entNome, setEntNome] = useState('');
  const [entHistorico, setEntHistorico] = useState('');
  const [brief, setBrief] = useState('');
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<PlanoIaNarrativo | null>(null);

  useEffect(() => {
    if (!projeto.entidadeId) return;
    getDoc(doc(db, 'entities', projeto.entidadeId)).then(snap => {
      if (snap.exists()) {
        const d = snap.data() as any;
        setEntNome(d.nome || '');
        setEntHistorico(d.historico || '');
      }
    });
  }, [projeto.entidadeId]);

  const modalidades = (projeto.modalidades || []).map(m => m.nome).filter(Boolean);
  const local = (projeto.locais || [])
    .map(l => `${(l.municipios || []).join(', ')}${l.uf ? `/${l.uf}` : ''}`)
    .filter(Boolean).join('; ');
  const publicoAlvo = projeto.publicoAlvo
    ? [projeto.publicoAlvo.direto && `direto: ${projeto.publicoAlvo.direto}`,
       projeto.publicoAlvo.faixaEtaria && `faixa etária: ${projeto.publicoAlvo.faixaEtaria}`,
       projeto.publicoAlvo.indireto && `indireto: ${projeto.publicoAlvo.indireto}`].filter(Boolean).join(' · ')
    : '';

  const gerar = async () => {
    setGerando(true);
    setErro(null);
    try {
      const r = await gerarPlanoComIA({
        titulo: projeto.titulo || '',
        brief,
        modalidades,
        publicoAlvo,
        local,
        periodoMeses: projeto.duracaoMeses,
        historicoEntidade: entHistorico,
        entidadeNome: entNome,
        instrumentoOrigem: typeof projeto.instrumentoOrigem === 'string' ? projeto.instrumentoOrigem : undefined,
      });
      setResultado(r);
    } catch (e: any) {
      setErro(e?.message || 'Falha ao gerar o plano.');
    } finally {
      setGerando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-violet-100 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-violet-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-lie-ink leading-tight">Gerar Plano com IA</h2>
              <p className="text-xs text-lie-gray">Resumo, objetivos, justificativa, caracterização e metodologia</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5" /></button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-5 space-y-4">
          {!resultado ? (
            <>
              {/* Contexto que a IA vai usar */}
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-600 space-y-1">
                <div className="font-bold text-gray-700 mb-1">A IA vai usar este contexto do projeto:</div>
                <div><strong>Título:</strong> {projeto.titulo || <span className="text-red-500">— defina o título do projeto antes</span>}</div>
                <div className="flex items-center gap-1">
                  <Building2 className="w-3.5 h-3.5" /> <strong>Entidade:</strong> {entNome || '—'}
                  {entHistorico
                    ? <span className="ml-1 text-emerald-600 font-semibold">· histórico incluído ✓</span>
                    : <span className="ml-1 text-amber-600 font-semibold">· sem histórico cadastrado</span>}
                </div>
                {modalidades.length > 0 && <div><strong>Modalidades:</strong> {modalidades.join(', ')}</div>}
                {publicoAlvo && <div><strong>Público-alvo:</strong> {publicoAlvo}</div>}
                {local && <div><strong>Local:</strong> {local}</div>}
                {projeto.duracaoMeses ? <div><strong>Duração:</strong> {projeto.duracaoMeses} meses</div> : null}
                {!entHistorico && (
                  <div className="flex items-start gap-1.5 mt-2 text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>Dica: cadastre o <strong>histórico da entidade</strong> (em Entidades) para o texto ficar muito mais forte e personalizado.</span>
                  </div>
                )}
              </div>

              {/* Brief */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Descreva o projeto em 1-2 frases <span className="text-gray-400 font-normal">(opcional, mas ajuda muito)</span>
                </label>
                <textarea
                  value={brief}
                  onChange={e => setBrief(e.target.value)}
                  rows={3}
                  placeholder="Ex: Campeonato escolar de modalidades coletivas para alunos da rede pública municipal, com etapas regionais e final, incluindo capacitação de professores."
                  className="w-full border border-gray-300 rounded-lg p-2.5 text-sm focus:ring-lie-green focus:border-lie-green"
                />
              </div>

              {erro && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {erro}
                </div>
              )}
            </>
          ) : (
            /* Pré-visualização do resultado */
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-emerald-700 text-sm font-semibold">
                <CheckCircle2 className="w-5 h-5" /> Texto gerado — revise antes de aplicar. Você poderá editar tudo no formulário.
              </div>
              {([
                ['Resumo', resultado.resumo],
                ['Objetivo Geral', resultado.objetivoGeral],
                ['Objetivos Específicos', resultado.objetivosEspecificos.map((o, i) => `${i + 1}. ${o}`).join('\n')],
                ['Justificativa', resultado.justificativa],
                ['Caracterização Socioeconômica', resultado.caracterizacaoSocioeconomica],
                ['Metodologia', resultado.metodologia],
              ] as [string, string][]).map(([titulo, texto]) => (
                <div key={titulo} className="border border-gray-200 rounded-lg p-3">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">{titulo}</div>
                  <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{texto || <span className="text-gray-400 italic">— vazio</span>}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-gray-100">
          {!resultado ? (
            <>
              <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium">Cancelar</button>
              <button
                onClick={gerar}
                disabled={gerando || !projeto.titulo}
                className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white px-5 py-2 rounded-lg font-bold shadow-sm"
              >
                {gerando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                {gerando ? 'Gerando…' : 'Gerar com IA'}
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setResultado(null)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium">Gerar de novo</button>
              <button
                onClick={() => { onApply(resultado); onClose(); }}
                className="flex items-center gap-2 bg-lie-green hover:bg-lie-greenDark text-white px-5 py-2 rounded-lg font-bold shadow-sm"
              >
                <CheckCircle2 className="w-4 h-4" /> Aplicar ao formulário
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
