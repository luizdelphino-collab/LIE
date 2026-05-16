import { useEffect, useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, getDoc, setDoc, serverTimestamp, collection, getDocs, orderBy, query } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Save, ArrowLeft, Image as ImageIcon, Plus, Trash2, Calendar, MapPin, Target, ListChecks, Info, X, Loader2, FileDown, FileText } from 'lucide-react';
import { db, storage } from '../lib/firebase';
import { consolidarProjeto } from '../lib/consolidarProjeto';
import RubricaModal from '../components/RubricaModal';
import type { Projeto, Entidade, InstrumentoOrigem, AmbitoAplicacao, AcaoCronograma, MetaProjeto } from '../types';

const INSTRUMENTOS: InstrumentoOrigem[] = [
  'LPIE', 'LIE', 'CONDECA', 'Emenda Federal', 'Emenda Estadual', 'Emenda Municipal',
  'Chamamento Público', 'Licitação', 'DL', 'Contratação Direta'
];

const ORGAOS = ['Ministério do Esporte', 'SESP', 'SEDUC', 'SME', 'SEME', 'outro'];

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

export default function ProjetoFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id || id === 'novo';

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [consolidando, setConsolidando] = useState(false);
  const [isEditing, setIsEditing] = useState(isNew);
  const [entidades, setEntidades] = useState<Entidade[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState<Partial<Projeto>>({
    titulo: '',
    entidadeId: '',
    instrumentoOrigem: 'LPIE',
    orgao: 'Ministério do Esporte',
    orgaoOutro: '',
    status: 'em_elaboracao',
    resumo: '',
    mesInicio: '',
    mesTermino: '',
    ambitoAplicacao: 'Municipal',
    locais: [],
    modalidades: [],
    pracaEsportiva: { nome: '', endereco: '' },
    objetivoGeral: '',
    objetivosEspecificos: ['', '', ''],
    justificativa: '',
    caracterizacaoSocioeconomica: '',
    metodologia: '',
    cronograma: [],
    publicoAlvo: { direto: '', faixaEtaria: '', indireto: '' },
    metasQualitativas: [
      { id: '1', meta: '', indicador: '', formula: '', verificacao: '' },
      { id: '2', meta: '', indicador: '', formula: '', verificacao: '' }
    ],
    metasQuantitativas: [
      { id: '1', meta: '', indicador: '', formula: '', verificacao: '' },
      { id: '2', meta: '', indicador: '', formula: '', verificacao: '' }
    ],
  });

  useEffect(() => {
    (async () => {
      // Carregar Entidades
      const entSnap = await getDocs(query(collection(db, 'entities'), orderBy('nome')));
      setEntidades(entSnap.docs.map(d => ({ id: d.id, ...d.data() } as Entidade)));

      if (!isNew && id) {
        try {
          const snap = await getDoc(doc(db, 'projects', id));
          if (snap.exists()) {
            setFormData(snap.data() as Projeto);
          }
        } finally {
          setLoading(false);
        }
      }
    })();
  }, [id, isNew]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.match(/image\/(png|jpeg|jpg)/)) {
      alert("Formato não aceito. Use PNG, JPG ou JPEG.");
      return;
    }

    if (file.size > 1024 * 1024) {
      alert("A imagem é muito grande (máximo 1MB).");
      return;
    }

    setSaving(true);
    try {
      const storageRef = ref(storage, `logos/projetos/${Date.now()}_${file.name}`);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      setFormData(prev => ({ ...prev, logoUrl: url }));
    } catch (err) {
      console.error(err);
      alert("Erro ao subir imagem.");
    } finally {
      setSaving(false);
    }
  };

  const handleScopeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const scope = e.target.value as AmbitoAplicacao;
    setFormData(prev => ({ ...prev, ambitoAplicacao: scope, locais: [] }));
  };

  const addLocal = () => {
    setFormData(prev => ({ ...prev, locais: [...(prev.locais || []), { uf: 'SP', municipios: [''] }] }));
  };

  const updateLocal = (index: number, field: string, value: string | string[]) => {
    const newLocais = [...(formData.locais || [])];
    newLocais[index] = { ...newLocais[index], [field]: value };
    setFormData(prev => ({ ...prev, locais: newLocais }));
  };

  const addMunicipio = (localIndex: number) => {
    const newLocais = [...(formData.locais || [])];
    newLocais[localIndex].municipios.push('');
    setFormData(prev => ({ ...prev, locais: newLocais }));
  };

  const updateMunicipio = (localIndex: number, munIndex: number, value: string) => {
    const newLocais = [...(formData.locais || [])];
    newLocais[localIndex].municipios[munIndex] = value;
    setFormData(prev => ({ ...prev, locais: newLocais }));
  };

  const removeLocal = (index: number) => {
    setFormData(prev => ({ ...prev, locais: prev.locais?.filter((_, i) => i !== index) }));
  };

  const removeMunicipio = (localIndex: number, munIndex: number) => {
    const newLocais = [...(formData.locais || [])];
    newLocais[localIndex].municipios = newLocais[localIndex].municipios.filter((_, i) => i !== munIndex);
    setFormData(prev => ({ ...prev, locais: newLocais }));
  };

  const handleObjectiveChange = (index: number, value: string) => {
    const newObj = [...(formData.objetivosEspecificos || ['', '', ''])];
    newObj[index] = value;
    setFormData(prev => ({ ...prev, objetivosEspecificos: newObj }));
  };

  const addObjective = () => setFormData(prev => ({ ...prev, objetivosEspecificos: [...(prev.objetivosEspecificos || []), ''] }));
  const removeObjective = (index: number) => setFormData(prev => ({ ...prev, objetivosEspecificos: prev.objetivosEspecificos?.filter((_, i) => i !== index) }));

  const toggleModalidade = (mod: string) => {
    const mods = [...(formData.modalidades || [])];
    if (mods.includes(mod)) {
      setFormData(prev => ({ ...prev, modalidades: mods.filter(m => m !== mod) }));
    } else {
      setFormData(prev => ({ ...prev, modalidades: [...mods, mod] }));
    }
  };

  const addAcao = () => {
    setFormData(prev => ({ 
      ...prev, 
      cronograma: [...(prev.cronograma || []), { id: Date.now().toString(), acao: '', descricao: '', mesInicio: prev.mesInicio || '', mesTermino: prev.mesTermino || '' }] 
    }));
  };

  const updateAcao = (index: number, field: keyof AcaoCronograma, value: string) => {
    const newCron = [...(formData.cronograma || [])];
    newCron[index] = { ...newCron[index], [field]: value };
    setFormData(prev => ({ ...prev, cronograma: newCron }));
  };

  const removeAcao = (index: number) => setFormData(prev => ({ ...prev, cronograma: prev.cronograma?.filter((_, i) => i !== index) }));

  const updateMeta = (type: 'qualitativas' | 'quantitativas', index: number, field: keyof MetaProjeto, value: string) => {
    const list = type === 'qualitativas' ? [...(formData.metasQualitativas || [])] : [...(formData.metasQuantitativas || [])];
    list[index] = { ...list[index], [field]: value };
    setFormData(prev => ({ ...prev, [type === 'qualitativas' ? 'metasQualitativas' : 'metasQuantitativas']: list }));
  };

  const addMeta = (type: 'qualitativas' | 'quantitativas') => {
    const list = type === 'qualitativas' ? [...(formData.metasQualitativas || [])] : [...(formData.metasQuantitativas || [])];
    list.push({ id: Date.now().toString(), meta: '', indicador: '', formula: '', verificacao: '' });
    setFormData(prev => ({ ...prev, [type === 'qualitativas' ? 'metasQualitativas' : 'metasQuantitativas']: list }));
  };

  const removeMeta = (type: 'qualitativas' | 'quantitativas', index: number) => {
    const list = type === 'qualitativas' ? [...(formData.metasQualitativas || [])] : [...(formData.metasQuantitativas || [])];
    if (list.length <= 2) return;
    const newList = list.filter((_, i) => i !== index);
    setFormData(prev => ({ ...prev, [type === 'qualitativas' ? 'metasQualitativas' : 'metasQuantitativas']: newList }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const projId = isNew ? doc(collection(db, 'projects')).id : id!;
      const payload = {
        ...formData,
        atualizadoEm: serverTimestamp(),
      };
      if (isNew) (payload as any).criadoEm = serverTimestamp();
      await setDoc(doc(db, 'projects', projId), payload, { merge: true });
      setIsEditing(false);
      if (isNew) navigate(`/projetos/${projId}`, { replace: true });
    } catch (err) {
      console.error(err);
      alert('Erro ao salvar projeto: ' + (err instanceof Error ? err.message : 'Erro desconhecido'));
    } finally {
      setSaving(false);
    }
  };

  const [modalOpen, setModalOpen] = useState(false);

  const handleConsolidar = () => {
    if (!id || isNew) return;
    setModalOpen(true);
  };

  const confirmConsolidar = async (rubricaUrl?: string) => {
    setModalOpen(false);
    setConsolidando(true);
    try {
      await consolidarProjeto(id!, rubricaUrl);
    } catch (err) {
      console.error(err);
      alert('Erro ao gerar PDF.');
    } finally {
      setConsolidando(false);
    }
  };

  const calculateStages = () => {
    if (!formData.mesInicio || !formData.mesTermino) return 0;
    const start = new Date(formData.mesInicio + '-01');
    const end = new Date(formData.mesTermino + '-01');
    const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) + 1;
    return months > 0 ? months : 0;
  };

  if (loading) return <div className="p-6 text-lie-gray">Carregando…</div>;

  const inputCls = "w-full border-gray-300 rounded-lg shadow-sm focus:ring-lie-green focus:border-lie-green disabled:bg-gray-50";

  return (
    <div className="p-6 max-w-5xl mx-auto pb-32">
      <header className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/projetos')} className="p-2 text-lie-gray hover:bg-gray-100 rounded-lg transition">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-4">
            {formData.logoUrl ? (
              <img src={formData.logoUrl} alt="Logo" className="w-16 h-16 rounded-lg object-contain bg-white border" />
            ) : (
              <div className="w-16 h-16 rounded-lg bg-gray-100 flex items-center justify-center text-gray-400 border border-dashed">
                <ImageIcon className="w-8 h-8" />
              </div>
            )}
            <div>
              <h1 className="text-2xl font-bold text-lie-ink">{isNew ? 'Novo Projeto' : formData.titulo || 'Projeto'}</h1>
              <p className="text-sm text-lie-gray">{formData.instrumentoOrigem}</p>
            </div>
          </div>
        </div>
        {!isNew && !isEditing && (
          <div className="flex gap-2">
            <button 
              onClick={() => navigate(`/projetos/${id}/documentos`)}
              className="inline-flex items-center gap-2 bg-white border border-gray-300 text-blue-600 px-4 py-2 rounded-lg hover:bg-blue-50 transition font-medium"
            >
              <FileText className="w-4 h-4" />
              Documentos
            </button>
            <button 
              onClick={handleConsolidar} 
              disabled={consolidando}
              className="inline-flex items-center gap-2 bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50 transition font-medium"
            >
              {consolidando ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
              Consolidar PDF
            </button>
            <button 
              onClick={() => setIsEditing(true)} 
              className="inline-flex items-center gap-2 bg-lie-green text-white px-4 py-2 rounded-lg hover:bg-lie-greenDark transition font-medium"
            >
              <Edit3 className="w-4 h-4" /> Editar Projeto
            </button>
          </div>
        )}
      </header>

      <form onSubmit={handleSubmit} className="space-y-8">
        
        {/* Identificação e Órgão */}
        <section className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
          <div className="flex items-center gap-2 mb-4 border-b border-gray-50 pb-2">
            <Info className="w-5 h-5 text-lie-green" />
            <h2 className="text-lg font-bold text-lie-ink">Identificação</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="md:col-span-2">
              <label className="block text-sm font-semibold text-gray-700 mb-1">Entidade Proponente *</label>
              <select 
                name="entidadeId" 
                required 
                value={formData.entidadeId} 
                onChange={handleChange} 
                disabled={!isEditing}
                className={inputCls}
              >
                <option value="">Selecione a entidade...</option>
                {entidades.map(ent => <option key={ent.id} value={ent.id}>{ent.sigla ? `[${ent.sigla}] ${ent.nome}` : ent.nome}</option>)}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-semibold text-gray-700 mb-1">Título do Projeto *</label>
              <input type="text" name="titulo" required value={formData.titulo} onChange={handleChange} disabled={!isEditing} className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Instrumento de Origem *</label>
              <select name="instrumentoOrigem" value={formData.instrumentoOrigem} onChange={handleChange} disabled={!isEditing} className={inputCls}>
                {INSTRUMENTOS.map(i => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Órgão *</label>
              <div className="space-y-2">
                <select name="orgao" value={formData.orgao} onChange={handleChange} disabled={!isEditing} className={inputCls}>
                  {ORGAOS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
                {formData.orgao === 'outro' && (
                  <input type="text" name="orgaoOutro" placeholder="Especifique o órgão" value={formData.orgaoOutro} onChange={handleChange} disabled={!isEditing} className={inputCls} />
                )}
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Logo do Projeto</label>
              <div className="flex flex-col gap-1 mt-1">
                <div className="flex items-center gap-4">
                  <button type="button" onClick={() => fileInputRef.current?.click()} disabled={!isEditing} className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 transition">
                    Selecionar Imagem
                  </button>
                  <input type="file" accept="image/png,image/jpeg" ref={fileInputRef} className="hidden" onChange={handleLogoUpload} />
                  {formData.logoUrl && isEditing && (
                    <button type="button" onClick={() => setFormData(p => ({...p, logoUrl: ''}))} className="text-red-500 text-sm font-medium hover:underline">Remover</button>
                  )}
                </div>
                <p className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">PNG, JPG ou JPEG • Máximo 1MB</p>
              </div>
            </div>
          </div>
        </section>

        {/* Plano de Trabalho - Período e Âmbito */}
        <section className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
          <div className="flex items-center gap-2 mb-4 border-b border-gray-50 pb-2">
            <Calendar className="w-5 h-5 text-lie-green" />
            <h2 className="text-lg font-bold text-lie-ink">Plano de Trabalho — Período e Âmbito</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="md:col-span-2">
              <label className="block text-sm font-semibold text-gray-700 mb-1">Resumo do Projeto</label>
              <textarea name="resumo" rows={3} value={formData.resumo} onChange={handleChange} disabled={!isEditing} className={inputCls}></textarea>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Mês de Início *</label>
              <input type="month" name="mesInicio" required value={formData.mesInicio} onChange={handleChange} disabled={!isEditing} className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Mês de Término *</label>
              <input type="month" name="mesTermino" required value={formData.mesTermino} onChange={handleChange} disabled={!isEditing} className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Número de Etapas (Meses)</label>
              <div className="px-4 py-2 bg-gray-100 rounded-lg text-lie-ink font-bold border border-gray-200">
                {calculateStages()} {calculateStages() === 1 ? 'mês' : 'meses'}
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Âmbito de Aplicação *</label>
              <select name="ambitoAplicacao" value={formData.ambitoAplicacao} onChange={handleScopeChange} disabled={!isEditing} className={inputCls}>
                <option value="Nacional">Nacional</option>
                <option value="Estadual">Estadual</option>
                <option value="Municipal">Municipal</option>
              </select>
            </div>
            
            {/* Seção de Locais Dinâmicos */}
            <div className="md:col-span-2 space-y-4 pt-2">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-semibold text-gray-700">Locais de Aplicação</label>
                {isEditing && (
                  <button type="button" onClick={addLocal} className="text-lie-green text-sm font-bold flex items-center gap-1 hover:underline">
                    <Plus className="w-4 h-4" /> Adicionar Estado/UF
                  </button>
                )}
              </div>
              
              {formData.locais?.map((local, lIdx) => (
                <div key={lIdx} className="p-4 bg-gray-50 rounded-lg border border-gray-200 relative">
                  {isEditing && (
                    <button type="button" onClick={() => removeLocal(lIdx)} className="absolute top-2 right-2 text-red-500 p-1 hover:bg-red-50 rounded">
                      <X className="w-4 h-4" />
                    </button>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Estado (UF)</label>
                      <select 
                        value={local.uf} 
                        onChange={(e) => updateLocal(lIdx, 'uf', e.target.value)} 
                        disabled={!isEditing} 
                        className={inputCls}
                      >
                        {UFS.map(uf => <option key={uf} value={uf}>{uf}</option>)}
                      </select>
                    </div>
                    <div className="md:col-span-3">
                      <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Municípios</label>
                      <div className="space-y-2">
                        {local.municipios.map((mun, mIdx) => (
                          <div key={mIdx} className="flex gap-2">
                            <input 
                              type="text" 
                              value={mun} 
                              onChange={(e) => updateMunicipio(lIdx, mIdx, e.target.value)} 
                              disabled={!isEditing} 
                              className={inputCls} 
                              placeholder="Nome da cidade"
                            />
                            {isEditing && local.municipios.length > 1 && (
                              <button type="button" onClick={() => removeMunicipio(lIdx, mIdx)} className="text-red-400 hover:text-red-600"><X className="w-4 h-4" /></button>
                            )}
                          </div>
                        ))}
                        {isEditing && (
                          <button type="button" onClick={() => addMunicipio(lIdx)} className="text-lie-green text-xs font-bold hover:underline">+ Adicionar Município</button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              {(!formData.locais || formData.locais.length === 0) && (
                <p className="text-sm text-gray-400 italic">Nenhum local adicionado.</p>
              )}
            </div>
          </div>
        </section>

        {/* Modalidades e Praça */}
        <section className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
          <div className="flex items-center gap-2 mb-4 border-b border-gray-50 pb-2">
            <Target className="w-5 h-5 text-lie-green" />
            <h2 className="text-lg font-bold text-lie-ink">Modalidades e Local</h2>
          </div>
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Modalidades Esportivas</label>
              <div className="flex flex-wrap gap-2">
                {['Futebol', 'Futsal', 'Basquetebol', 'Voleibol', 'Handebol', 'Judô', 'Karatê', 'Natação', 'Atletismo', 'Tênis', 'Outra'].map(mod => (
                  <button
                    key={mod}
                    type="button"
                    onClick={() => isEditing && toggleModalidade(mod)}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium border transition ${
                      formData.modalidades?.includes(mod)
                        ? 'bg-lie-green text-white border-lie-green'
                        : 'bg-white text-gray-600 border-gray-300 hover:border-lie-green'
                    } ${!isEditing && 'cursor-default'}`}
                  >
                    {mod}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Praça Esportiva (Nome)</label>
                <input 
                  type="text" 
                  value={formData.pracaEsportiva?.nome || ''} 
                  onChange={(e) => setFormData(p => ({...p, pracaEsportiva: { ...(p.pracaEsportiva || {}), nome: e.target.value }}))} 
                  disabled={!isEditing} 
                  className={inputCls} 
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Endereço da Praça</label>
                <input 
                  type="text" 
                  value={formData.pracaEsportiva?.endereco || ''} 
                  onChange={(e) => setFormData(p => ({...p, pracaEsportiva: { ...(p.pracaEsportiva || {}), endereco: e.target.value }}))} 
                  disabled={!isEditing} 
                  className={inputCls} 
                />
              </div>
            </div>
          </div>
        </section>

        {/* Objetivos */}
        <section className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
          <div className="flex items-center gap-2 mb-4 border-b border-gray-50 pb-2">
            <ListChecks className="w-5 h-5 text-lie-green" />
            <h2 className="text-lg font-bold text-lie-ink">Objetivos</h2>
          </div>
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Objetivo Geral *</label>
              <textarea name="objetivoGeral" rows={2} required value={formData.objetivoGeral} onChange={handleChange} disabled={!isEditing} className={inputCls}></textarea>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-semibold text-gray-700">Objetivos Específicos (Mínimo 3) *</label>
                {isEditing && (
                  <button type="button" onClick={addObjective} className="text-lie-green text-sm font-bold flex items-center gap-1 hover:underline">
                    <Plus className="w-4 h-4" /> Adicionar
                  </button>
                )}
              </div>
              <div className="space-y-3">
                {formData.objetivosEspecificos?.map((obj, idx) => (
                  <div key={idx} className="flex gap-2">
                    <span className="flex-shrink-0 w-8 h-10 flex items-center justify-center bg-gray-100 rounded-lg text-gray-500 font-bold">{idx + 1}</span>
                    <input 
                      type="text" 
                      required={idx < 3} 
                      value={obj} 
                      onChange={(e) => handleObjectiveChange(idx, e.target.value)} 
                      disabled={!isEditing} 
                      className={inputCls} 
                    />
                    {isEditing && formData.objetivosEspecificos && formData.objetivosEspecificos.length > 3 && (
                      <button type="button" onClick={() => removeObjective(idx)} className="text-red-500"><Trash2 className="w-4 h-4" /></button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Justificativa e Metodologia */}
        <section className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
          <div className="flex items-center gap-2 mb-4 border-b border-gray-50 pb-2">
            <Info className="w-5 h-5 text-lie-green" />
            <h2 className="text-lg font-bold text-lie-ink">Justificativa e Metodologia</h2>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Justificativa *</label>
              <textarea name="justificativa" rows={4} required value={formData.justificativa} onChange={handleChange} disabled={!isEditing} className={inputCls}></textarea>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Caracterização Socioeconômica (IDH, Região) *</label>
              <textarea name="caracterizacaoSocioeconomica" rows={3} required value={formData.caracterizacaoSocioeconomica} onChange={handleChange} disabled={!isEditing} className={inputCls}></textarea>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Metodologia de Aplicação *</label>
              <textarea name="metodologia" rows={4} required value={formData.metodologia} onChange={handleChange} disabled={!isEditing} className={inputCls}></textarea>
            </div>
          </div>
        </section>

        {/* Cronograma */}
        <section className="bg-white rounded-xl shadow-sm p-6 border border-gray-100 overflow-hidden">
          <div className="flex items-center justify-between mb-4 border-b border-gray-50 pb-2">
            <div className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-lie-green" />
              <h2 className="text-lg font-bold text-lie-ink">Cronograma Previsto</h2>
            </div>
            {isEditing && (
              <button type="button" onClick={addAcao} className="inline-flex items-center gap-2 bg-lie-green text-white px-3 py-1.5 rounded-lg text-sm font-bold">
                <Plus className="w-4 h-4" /> Adicionar Ação
              </button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-lie-gray border-b border-gray-200">
                <tr>
                  <th className="px-3 py-2">Ação</th>
                  <th className="px-3 py-2">Descrição</th>
                  <th className="px-3 py-2 w-40">Início</th>
                  <th className="px-3 py-2 w-40">Término</th>
                  {isEditing && <th className="px-3 py-2 w-10"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {formData.cronograma?.map((acao, idx) => (
                  <tr key={acao.id}>
                    <td className="p-2"><input type="text" value={acao.acao} onChange={e => updateAcao(idx, 'acao', e.target.value)} disabled={!isEditing} className={inputCls + " text-sm"} placeholder="Título da ação" /></td>
                    <td className="p-2"><textarea rows={1} value={acao.descricao} onChange={e => updateAcao(idx, 'descricao', e.target.value)} disabled={!isEditing} className={inputCls + " text-sm"} placeholder="Detalhes..." /></td>
                    <td className="p-2">
                      <input 
                        type="month" 
                        value={acao.mesInicio} 
                        min={formData.mesInicio} 
                        max={formData.mesTermino} 
                        onChange={e => updateAcao(idx, 'mesInicio', e.target.value)} 
                        disabled={!isEditing} 
                        className={inputCls + " text-sm"} 
                      />
                    </td>
                    <td className="p-2">
                      <input 
                        type="month" 
                        value={acao.mesTermino} 
                        min={acao.mesInicio || formData.mesInicio} 
                        max={formData.mesTermino} 
                        onChange={e => updateAcao(idx, 'mesTermino', e.target.value)} 
                        disabled={!isEditing} 
                        className={inputCls + " text-sm"} 
                      />
                    </td>
                    {isEditing && (
                      <td className="p-2"><button type="button" onClick={() => removeAcao(idx)} className="text-red-500 hover:bg-red-50 p-1 rounded"><Trash2 className="w-4 h-4" /></button></td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {(!formData.cronograma || formData.cronograma.length === 0) && (
              <div className="p-8 text-center text-gray-400 italic">Nenhuma ação cadastrada.</div>
            )}
          </div>
        </section>

        {/* Público Alvo */}
        <section className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
          <div className="flex items-center gap-2 mb-4 border-b border-gray-50 pb-2">
            <Target className="w-5 h-5 text-lie-green" />
            <h2 className="text-lg font-bold text-lie-ink">Público Alvo</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Público Direto *</label>
              <input type="text" value={formData.publicoAlvo?.direto} onChange={e => setFormData(p => ({...p, publicoAlvo: {...(p.publicoAlvo || {direto: '', faixaEtaria: '', indireto: ''}), direto: e.target.value}}))} disabled={!isEditing} className={inputCls} placeholder="Ex: 200 atletas" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Faixa Etária *</label>
              <input type="text" value={formData.publicoAlvo?.faixaEtaria} onChange={e => setFormData(p => ({...p, publicoAlvo: {...(p.publicoAlvo || {direto: '', faixaEtaria: '', indireto: ''}), faixaEtaria: e.target.value}}))} disabled={!isEditing} className={inputCls} placeholder="Ex: 07 a 17 anos" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Público Indireto *</label>
              <input type="text" value={formData.publicoAlvo?.indireto} onChange={e => setFormData(p => ({...p, publicoAlvo: {...(p.publicoAlvo || {direto: '', faixaEtaria: '', indireto: ''}), indireto: e.target.value}}))} disabled={!isEditing} className={inputCls} placeholder="Ex: 1000 familiares" />
            </div>
          </div>
        </section>

        {/* Metas */}
        {['qualitativas', 'quantitativas'].map((type) => (
          <section key={type} className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
            <div className="flex items-center justify-between mb-4 border-b border-gray-50 pb-2">
              <div className="flex items-center gap-2">
                <ListChecks className="w-5 h-5 text-lie-green" />
                <h2 className="text-lg font-bold text-lie-ink uppercase tracking-wider">Metas {type} (Mín. 2)</h2>
              </div>
              {isEditing && (
                <button type="button" onClick={() => addMeta(type as any)} className="text-lie-green text-sm font-bold flex items-center gap-1 hover:underline">
                  <Plus className="w-4 h-4" /> Adicionar Meta
                </button>
              )}
            </div>
            <div className="space-y-6">
              {(type === 'qualitativas' ? formData.metasQualitativas : formData.metasQuantitativas)?.map((meta, idx) => (
                <div key={meta.id} className="p-4 bg-gray-50 rounded-xl border border-gray-200 relative">
                  {isEditing && (type === 'qualitativas' ? formData.metasQualitativas : formData.metasQuantitativas)!.length > 2 && (
                    <button type="button" onClick={() => removeMeta(type as any, idx)} className="absolute top-2 right-2 text-red-500 p-1 hover:bg-red-50 rounded">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="md:col-span-2">
                      <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Título da Meta *</label>
                      <input type="text" value={meta.meta} onChange={e => updateMeta(type as any, idx, 'meta', e.target.value)} disabled={!isEditing} className={inputCls} />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Indicador *</label>
                      <input type="text" value={meta.indicador} onChange={e => updateMeta(type as any, idx, 'indicador', e.target.value)} disabled={!isEditing} className={inputCls} />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Fórmula de Cálculo *</label>
                      <input type="text" value={meta.formula} onChange={e => updateMeta(type as any, idx, 'formula', e.target.value)} disabled={!isEditing} className={inputCls} />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Meio de Verificação *</label>
                      <input type="text" value={meta.verificacao} onChange={e => updateMeta(type as any, idx, 'verificacao', e.target.value)} disabled={!isEditing} className={inputCls} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}

        {/* Botão Salvar Fixo */}
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 shadow-lg z-20">
          <div className="max-w-5xl mx-auto flex items-center justify-between">
            <button type="button" onClick={() => navigate('/projetos')} className="px-6 py-2 text-gray-700 hover:bg-gray-100 font-medium rounded-lg transition">
              Voltar
            </button>
            <div className="flex gap-3">
              {isEditing && (
                <button type="submit" disabled={saving} className="inline-flex items-center gap-2 bg-lie-green hover:bg-lie-greenDark text-white px-8 py-2 font-bold rounded-lg shadow-sm transition">
                  <Save className="w-5 h-5" /> {saving ? 'Salvando...' : 'Salvar Projeto'}
                </button>
              )}
            </div>
          </div>
        </div>

      </form>

      {/* Botão flutuante de Consolidar para Visualização */}
      {!isEditing && (
        <button
          onClick={handleConsolidar}
          disabled={consolidando}
          className="fixed bottom-8 right-8 bg-lie-green hover:bg-lie-greenDark text-white w-14 h-14 rounded-full shadow-2xl flex items-center justify-center transition-all hover:scale-110 active:scale-95 disabled:opacity-50 z-30"
          title="Consolidar PDF"
        >
          {consolidando ? <Loader2 className="w-6 h-6 animate-spin" /> : <FileDown className="w-6 h-6" />}
        </button>
      )}

      <RubricaModal 
        isOpen={modalOpen} 
        onClose={() => setModalOpen(false)} 
        onConfirm={confirmConsolidar}
        title="Plano de Trabalho"
      />
    </div>
  );
}

const Edit3 = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>;
