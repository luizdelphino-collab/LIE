import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { ArrowLeft, Save, Award, BookOpen, Loader2, CheckCircle2 } from 'lucide-react';
import { db } from '../lib/firebase';
import type { Entidade } from '../types';

export default function CapacidadeTecnicaPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [entidade, setEntidade] = useState<Entidade | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const [historico, setHistorico] = useState('');
  const [capacidadeTecnica, setCapacidadeTecnica] = useState('');

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'entities', id));
        if (snap.exists()) {
          const ent = { id: snap.id, ...snap.data() } as Entidade;
          setEntidade(ent);
          setHistorico((ent as any).historico || '');
          setCapacidadeTecnica((ent as any).capacidadeTecnica || '');
        }
      } catch (err) {
        console.error('Erro ao carregar entidade:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const handleSalvar = async () => {
    if (!id) return;
    setSaving(true);
    try {
      await setDoc(
        doc(db, 'entities', id),
        {
          historico,
          capacidadeTecnica,
          atualizadoEm: serverTimestamp()
        },
        { merge: true }
      );
      setSavedAt(new Date());
    } catch (err: any) {
      console.error(err);
      alert(`Erro ao salvar: ${err?.message || err}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="p-6 text-lie-gray">Carregando…</div>;
  }

  if (!entidade) {
    return (
      <div className="p-6 text-center text-lie-gray">
        Entidade não encontrada.
        <button
          onClick={() => navigate('/entidades')}
          className="ml-2 text-lie-green underline"
        >
          Voltar
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/entidades')}
            className="p-2 text-lie-gray hover:bg-gray-100 rounded-lg transition"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-lie-ink flex items-center gap-2">
              <Award className="w-6 h-6 text-amber-600" />
              Capacidade Técnica e Operacional
            </h1>
            <p className="text-sm text-lie-gray">
              {entidade.nome}
              {entidade.sigla && <span className="ml-1 text-gray-400">({entidade.sigla})</span>}
            </p>
          </div>
        </div>
      </header>

      <div className="bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 rounded-xl p-4 mb-6 text-sm text-amber-900 leading-relaxed">
        <p>
          <strong>Por que cadastrar isso?</strong> Esses dois campos são impressos como uma
          seção dedicada do consolidado do projeto (quando marcada a opção
          <em> Capacidade Técnica e Operacional</em> no modal de geração de PDF).
          O conteúdo aqui é o que demonstra ao parecerista a experiência institucional
          e a capacidade técnica da entidade pra executar o projeto.
        </p>
      </div>

      <div className="space-y-6">
        <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
          <label className="flex items-center gap-2 text-base font-bold text-lie-ink mb-1">
            <BookOpen className="w-5 h-5 text-lie-green" />
            Histórico Institucional
          </label>
          <p className="text-xs text-gray-500 mb-3">
            Conte a trajetória da entidade: fundação, missão, valores, principais marcos,
            áreas de atuação e ações realizadas ao longo dos anos.
          </p>
          <textarea
            value={historico}
            onChange={(e) => setHistorico(e.target.value)}
            rows={12}
            placeholder="Ex.: Fundada em 1995, a entidade tem por missão promover…"
            className="w-full border border-gray-300 rounded-lg shadow-sm p-3 text-sm leading-relaxed focus:ring-lie-green focus:border-lie-green resize-y"
          />
          <div className="text-right text-xs text-gray-400 mt-1">
            {historico.length} caracteres
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
          <label className="flex items-center gap-2 text-base font-bold text-lie-ink mb-1">
            <Award className="w-5 h-5 text-amber-600" />
            Capacidade Técnica e Operacional
          </label>
          <p className="text-xs text-gray-500 mb-3">
            Descreva equipe técnica, infraestrutura disponível, experiências anteriores em
            projetos similares, parcerias relevantes, certificações e qualquer elemento
            que comprove a capacidade de execução.
          </p>
          <textarea
            value={capacidadeTecnica}
            onChange={(e) => setCapacidadeTecnica(e.target.value)}
            rows={12}
            placeholder="Ex.: A entidade conta com equipe técnica multidisciplinar composta por…"
            className="w-full border border-gray-300 rounded-lg shadow-sm p-3 text-sm leading-relaxed focus:ring-lie-green focus:border-lie-green resize-y"
          />
          <div className="text-right text-xs text-gray-400 mt-1">
            {capacidadeTecnica.length} caracteres
          </div>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between gap-4 sticky bottom-4">
        <div className="text-xs text-gray-500">
          {savedAt && (
            <span className="flex items-center gap-1.5 text-green-700">
              <CheckCircle2 className="w-4 h-4" />
              Salvo às {savedAt.toLocaleTimeString('pt-BR')}
            </span>
          )}
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => navigate('/entidades')}
            className="px-4 py-2 font-bold text-gray-600 hover:bg-gray-100 rounded-lg transition"
          >
            Voltar
          </button>
          <button
            onClick={handleSalvar}
            disabled={saving}
            className="px-6 py-2 bg-lie-green text-white font-bold rounded-lg hover:bg-lie-greenDark transition flex items-center gap-2 shadow-sm disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}
