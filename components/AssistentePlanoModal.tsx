/**
 * components/AssistentePlanoModal.tsx
 *
 * Assistente de Plano de Trabalho com IA (Fase A).
 * É um questionário guiado que COLETA todas as informações mínimas necessárias
 * para montar o plano (funciona mesmo com projeto vazio), puxa o histórico da
 * entidade, e gera com o Gemini os campos narrativos. Ao aplicar, preenche tanto
 * os campos estruturados (entidade, título, modalidades, público, local, período)
 * quanto os textos gerados. O usuário revisa antes de aplicar.
 */

import { useEffect, useState } from 'react';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { Sparkles, X, Loader2, CheckCircle2, AlertTriangle, Wand2, ChevronRight, ChevronLeft } from 'lucide-react';
import { db } from '../lib/firebase';
import type { Projeto } from '../types';
import { gerarPlanoComIA, type PlanoIaNarrativo } from '../lib/planoIaApi';

interface Props {
  projeto: Partial<Projeto>;
  onClose: () => void;
  /** Recebe os campos estruturados coletados + os textos gerados, prontos pra mesclar no formulário. */
  onApply: (dados: Partial<Projeto>) => void;
}

const INSTRUMENTOS = ['LPIE', 'LIE', 'CONDECA', 'Emenda Federal', 'Emenda Estadual', 'Emenda Municipal', 'Chamamento Público', 'Licitação', 'Dispensa de Licitação', 'Contratação Direta'];
const TIPOS_ACAO = ['Competição / Campeonato', 'Escolinha / Formação esportiva', 'Capacitação / Curso', 'Evento / Festival esportivo', 'Misto'];
const AMBITOS = ['Municipal', 'Estadual', 'Nacional'];

function difMeses(ini?: string, fim?: string): number | undefined {
  if (!ini || !fim) return undefined;
  const [ay, am] = ini.split('-').map(Number);
  const [by, bm] = fim.split('-').map(Number);
  if (!ay || !am || !by || !bm) return undefined;
  const d = (by - ay) * 12 + (bm - am) + 1;
  return d > 0 ? d : undefined;
}

const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-lie-green focus:border-lie-green';
const labelCls = 'block text-sm font-semibold text-gray-700 mb-1';

export default function AssistentePlanoModal({ projeto, onClose, onApply }: Props) {
  const [entidades, setEntidades] = useState<{ id: string; nome: string; historico?: string }[]>([]);
  const [step, setStep] = useState(1); // 1 = perguntas, 2 = preview
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<PlanoIaNarrativo | null>(null);

  // ----- Inputs (pré-preenchidos com o que o projeto já tiver) -----
  const [entidadeId, setEntidadeId] = useState(projeto.entidadeId || '');
  const [historico, setHistorico] = useState('');
  const [titulo, setTitulo] = useState(projeto.titulo || '');
  const [instrumento, setInstrumento] = useState(typeof projeto.instrumentoOrigem === 'string' ? projeto.instrumentoOrigem : '');
  const [modalidades, setModalidades] = useState((projeto.modalidades || []).map(m => m.nome).join(', '));
  const [tipoAcao, setTipoAcao] = useState('');
  const [brief, setBrief] = useState('');
  const [faixaEtaria, setFaixaEtaria] = useState(projeto.publicoAlvo?.faixaEtaria || '');
  const [publicoDireto, setPublicoDireto] = useState(projeto.publicoAlvo?.direto || '');
  const [publicoIndireto, setPublicoIndireto] = useState(projeto.publicoAlvo?.indireto || '');
  const [ambito, setAmbito] = useState((projeto.ambitoAplicacao as string) || 'Municipal');
  const [municipio, setMunicipio] = useState(projeto.locais?.[0]?.municipios?.[0] || '');
  const [uf, setUf] = useState(projeto.locais?.[0]?.uf || 'SP');
  const [mesInicio, setMesInicio] = useState(projeto.mesInicio || '');
  const [mesTermino, setMesTermino] = useState(projeto.mesTermino || '');

  useEffect(() => {
    getDocs(collection(db, 'entities')).then(snap => {
      setEntidades(snap.docs.map(d => ({ id: d.id, nome: (d.data() as any).nome || '(sem nome)', historico: (d.data() as any).historico })));
    });
  }, []);

  // Carrega histórico da entidade selecionada
  useEffect(() => {
    if (!entidadeId) { setHistorico(''); return; }
    const cached = entidades.find(e => e.id === entidadeId);
    if (cached?.historico !== undefined) { setHistorico(cached.historico || ''); return; }
    getDoc(doc(db, 'entities', entidadeId)).then(s => { if (s.exists()) setHistorico((s.data() as any).historico || ''); });
  }, [entidadeId, entidades]);

  const duracaoMeses = difMeses(mesInicio, mesTermino);

  // Validação mínima
  const faltando: string[] = [];
  if (!entidadeId) faltando.push('entidade proponente');
  if (!titulo.trim()) faltando.push('título do projeto');
  if (!modalidades.trim()) faltando.push('modalidades esportivas');
  if (!brief.trim()) faltando.push('o que o projeto faz');
  if (!mesInicio || !mesTermino) faltando.push('período (início e término)');
  const podeGerar = faltando.length === 0;

  const modalidadesArr = modalidades.split(',').map(s => s.trim()).filter(Boolean);
  const publicoAlvoStr = [
    publicoDireto && `público direto: ${publicoDireto}`,
    faixaEtaria && `faixa etária: ${faixaEtaria}`,
    publicoIndireto && `público indireto: ${publicoIndireto}`,
  ].filter(Boolean).join(' · ');
  const localStr = [municipio, uf].filter(Boolean).join('/');
  const entidadeNome = entidades.find(e => e.id === entidadeId)?.nome || '';

  const gerar = async () => {
    if (!podeGerar) return;
    setGerando(true);
    setErro(null);
    try {
      const briefCompleto = [tipoAcao && `Tipo de ação: ${tipoAcao}.`, brief].filter(Boolean).join(' ');
      const r = await gerarPlanoComIA({
        titulo: titulo.trim(),
        brief: briefCompleto,
        modalidades: modalidadesArr,
        publicoAlvo: publicoAlvoStr,
        local: `${localStr} (âmbito ${ambito})`,
        periodoMeses: duracaoMeses,
        historicoEntidade: historico,
        entidadeNome,
        instrumentoOrigem: instrumento || undefined,
      });
      setResultado(r);
      setStep(2);
    } catch (e: any) {
      setErro(e?.message || 'Falha ao gerar o plano.');
    } finally {
      setGerando(false);
    }
  };

  const aplicar = () => {
    if (!resultado) return;
    const dados: Partial<Projeto> = {
      entidadeId,
      titulo: titulo.trim(),
      instrumentoOrigem: instrumento || projeto.instrumentoOrigem,
      modalidades: modalidadesArr.map(nome => ({ nome, paralimpica: false })),
      ambitoAplicacao: ambito as any,
      ...(municipio ? { locais: [{ uf, municipios: [municipio] }] } : {}),
      mesInicio, mesTermino,
      ...(duracaoMeses ? { duracaoMeses } : {}),
      publicoAlvo: { direto: publicoDireto, faixaEtaria, indireto: publicoIndireto },
      resumo: resultado.resumo,
      objetivoGeral: resultado.objetivoGeral,
      objetivosEspecificos: resultado.objetivosEspecificos,
      justificativa: resultado.justificativa,
      caracterizacaoSocioeconomica: resultado.caracterizacaoSocioeconomica,
      metodologia: resultado.metodologia,
      planoDivulgacao: resultado.planoDivulgacao,
    };
    onApply(dados);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-violet-100 flex items-center justify-center"><Sparkles className="w-5 h-5 text-violet-600" /></div>
            <div>
              <h2 className="text-lg font-bold text-lie-ink leading-tight">Assistente de Plano de Trabalho</h2>
              <p className="text-xs text-lie-gray">{step === 1 ? 'Responda o mínimo necessário — a IA monta o resto' : 'Revise o texto gerado antes de aplicar'}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5" /></button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-5">
          {step === 1 ? (
            <div className="space-y-5">
              {/* Identificação */}
              <section className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-violet-700">1 · Identificação</h3>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Entidade proponente *</label>
                    <select value={entidadeId} onChange={e => setEntidadeId(e.target.value)} className={inputCls}>
                      <option value="">Selecione…</option>
                      {entidades.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
                    </select>
                    {entidadeId && (
                      <p className={`text-[11px] mt-1 font-semibold ${historico ? 'text-emerald-600' : 'text-amber-600'}`}>
                        {historico ? '✓ histórico da entidade será usado pela IA' : '⚠ entidade sem histórico cadastrado'}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className={labelCls}>Instrumento de origem</label>
                    <select value={instrumento} onChange={e => setInstrumento(e.target.value)} className={inputCls}>
                      <option value="">Selecione…</option>
                      {INSTRUMENTOS.map(i => <option key={i} value={i}>{i}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Título do projeto *</label>
                  <input value={titulo} onChange={e => setTitulo(e.target.value)} className={inputCls} placeholder="Ex: Campeonato Escolar de Atletismo da Rede Municipal" />
                </div>
              </section>

              {/* Escopo */}
              <section className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-violet-700">2 · Escopo esportivo</h3>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Modalidades esportivas *</label>
                    <input value={modalidades} onChange={e => setModalidades(e.target.value)} className={inputCls} placeholder="Ex: Atletismo, Futsal, Vôlei (separe por vírgula)" />
                  </div>
                  <div>
                    <label className={labelCls}>Tipo de ação</label>
                    <select value={tipoAcao} onChange={e => setTipoAcao(e.target.value)} className={inputCls}>
                      <option value="">Selecione…</option>
                      {TIPOS_ACAO.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className={labelCls}>O que o projeto faz? *<span className="text-gray-400 font-normal"> — 1 a 3 frases; é a base da geração</span></label>
                  <textarea value={brief} onChange={e => setBrief(e.target.value)} rows={3} className={inputCls} placeholder="Ex: Competição de atletismo para alunos de escolas públicas municipais, com etapas regionais e final estadual, incluindo capacitação de professores de educação física." />
                </div>
              </section>

              {/* Público e território */}
              <section className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-violet-700">3 · Público e território</h3>
                <div className="grid sm:grid-cols-3 gap-3">
                  <div>
                    <label className={labelCls}>Faixa etária</label>
                    <input value={faixaEtaria} onChange={e => setFaixaEtaria(e.target.value)} className={inputCls} placeholder="Ex: 12 a 17 anos" />
                  </div>
                  <div>
                    <label className={labelCls}>Público direto (qtd)</label>
                    <input value={publicoDireto} onChange={e => setPublicoDireto(e.target.value)} className={inputCls} placeholder="Ex: 2.000 alunos" />
                  </div>
                  <div>
                    <label className={labelCls}>Público indireto</label>
                    <input value={publicoIndireto} onChange={e => setPublicoIndireto(e.target.value)} className={inputCls} placeholder="Ex: 10.000 (famílias)" />
                  </div>
                </div>
                <div className="grid sm:grid-cols-3 gap-3">
                  <div>
                    <label className={labelCls}>Âmbito</label>
                    <select value={ambito} onChange={e => setAmbito(e.target.value)} className={inputCls}>
                      {AMBITOS.map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Município</label>
                    <input value={municipio} onChange={e => setMunicipio(e.target.value)} className={inputCls} placeholder="Ex: São Paulo" />
                  </div>
                  <div>
                    <label className={labelCls}>UF</label>
                    <input value={uf} onChange={e => setUf(e.target.value.toUpperCase().slice(0, 2))} className={inputCls} placeholder="SP" />
                  </div>
                </div>
              </section>

              {/* Período */}
              <section className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-violet-700">4 · Período de execução *</h3>
                <div className="grid sm:grid-cols-3 gap-3 items-end">
                  <div>
                    <label className={labelCls}>Mês de início</label>
                    <input type="month" value={mesInicio} onChange={e => setMesInicio(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Mês de término</label>
                    <input type="month" value={mesTermino} onChange={e => setMesTermino(e.target.value)} className={inputCls} />
                  </div>
                  <div className="text-sm text-lie-gray pb-2">{duracaoMeses ? <><strong className="text-lie-ink">{duracaoMeses}</strong> meses</> : '—'}</div>
                </div>
              </section>

              {erro && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {erro}
                </div>
              )}
            </div>
          ) : (
            /* Preview */
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-emerald-700 text-sm font-semibold">
                <CheckCircle2 className="w-5 h-5" /> Texto gerado — revise. Ao aplicar, preencho também entidade, título, modalidades, público, local e período.
              </div>
              {resultado && ([
                ['Resumo', resultado.resumo],
                ['Objetivo Geral', resultado.objetivoGeral],
                ['Objetivos Específicos', resultado.objetivosEspecificos.map((o, i) => `${i + 1}. ${o}`).join('\n')],
                ['Justificativa', resultado.justificativa],
                ['Caracterização Socioeconômica', resultado.caracterizacaoSocioeconomica],
                ['Metodologia', resultado.metodologia],
                ['Plano de Divulgação', resultado.planoDivulgacao],
              ] as [string, string][]).map(([t, txt]) => (
                <div key={t} className="border border-gray-200 rounded-lg p-3">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">{t}</div>
                  <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{txt || <span className="text-gray-400 italic">— vazio</span>}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-gray-100">
          <div className="text-xs text-amber-600">
            {step === 1 && !podeGerar && <span><AlertTriangle className="w-3.5 h-3.5 inline mr-1" />Falta: {faltando.join(', ')}</span>}
          </div>
          <div className="flex items-center gap-3">
            {step === 1 ? (
              <>
                <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium">Cancelar</button>
                <button onClick={gerar} disabled={gerando || !podeGerar}
                  className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white px-5 py-2 rounded-lg font-bold shadow-sm">
                  {gerando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                  {gerando ? 'Gerando…' : 'Gerar com IA'} {!gerando && <ChevronRight className="w-4 h-4" />}
                </button>
              </>
            ) : (
              <>
                <button onClick={() => setStep(1)} className="flex items-center gap-1 px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium"><ChevronLeft className="w-4 h-4" /> Ajustar respostas</button>
                <button onClick={aplicar} className="flex items-center gap-2 bg-lie-green hover:bg-lie-greenDark text-white px-5 py-2 rounded-lg font-bold shadow-sm">
                  <CheckCircle2 className="w-4 h-4" /> Aplicar ao formulário
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
