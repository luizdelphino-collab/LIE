import { useEffect, useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ProjetoWorkspaceNav from '../components/ProjetoWorkspaceNav';
import AutoResizeTextarea from '../components/AutoResizeTextarea';
import { doc, getDoc, setDoc, serverTimestamp, collection, getDocs, orderBy, query, writeBatch, deleteDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Save, ArrowLeft, Image as ImageIcon, Plus, Trash2, Calendar, MapPin, Target, ListChecks, Info, X, Loader2, Printer, FileText, Package, Settings, Sparkles } from 'lucide-react';
import AssistentePlanoModal from '../components/AssistentePlanoModal';
import { db, storage } from '../lib/firebase';
import { consolidarProjeto, type PrintOptions } from '../lib/consolidarProjeto';
import PrintOptionsModal from '../components/PrintOptionsModal';
import type { Projeto, Entidade, InstrumentoOrigem, AmbitoAplicacao, AcaoCronograma, MetaProjeto, ModalidadeProjeto } from '../types';

const INSTRUMENTOS: InstrumentoOrigem[] = [
  'LPIE', 'LIE', 'CONDECA', 'Emenda Federal', 'Emenda Estadual', 'Emenda Municipal',
  'Chamamento Público', 'Licitação', 'DL', 'Contratação Direta'
];

const ORGAOS = ['Ministério do Esporte', 'SESP', 'SEDUC', 'SME', 'SEME', 'outro'];

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

const MODALIDADES_LISTA: string[] = [
  'Atletismo', 'Badminton', 'Basquete 3x3', 'Basquete em Cadeira', 'Basquetebol',
  'Beach Tennis', 'Bocha', 'Boxe', 'Ciclismo', 'Damas', 'Esgrima',
  'Futebol', 'Futsal', 'Gin\u00e1stica Art\u00edstica', 'Gin\u00e1stica R\u00edtmica',
  'Handebol', 'Jud\u00f4', 'Karat\u00ea', 'Nata\u00e7\u00e3o', 'Paral\u00edmpico Goalball',
  'Remo Virtual', 'Skate', 'Taekwondo', 'T\u00eanis de Mesa', 'T\u00eanis em Cadeira',
  'Tiro com Arco', 'Triatlhon', 'V\u00f4lei de Praia', 'Volei Sentado', 'Voleibol',
  'Wrestling', 'Xadrez'
];

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
  const [selectedMod, setSelectedMod] = useState<string>('');
  const [originalPeriod, setOriginalPeriod] = useState<{ mesInicio?: string; mesTermino?: string }>({});
  const [modalidadesLista, setModalidadesLista] = useState<string[]>([]);
  const [isManagingModalidades, setIsManagingModalidades] = useState(false);
  const [novaModalidadeGlobal, setNovaModalidadeGlobal] = useState('');
  const [savingModGlobal, setSavingModGlobal] = useState(false);
  const [assistenteOpen, setAssistenteOpen] = useState(false);

  // Aplica os campos coletados/gerados pela wizard de IA (entra em modo edição).
  const aplicarPlanoIA = (dados: Partial<typeof formData>) => {
    setIsEditing(true);
    setFormData(p => ({ ...p, ...dados }));
  };

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
    objetivoGeral: '',
    objetivosEspecificos: ['', '', ''],
    justificativa: '',
    caracterizacaoSocioeconomica: '',
    metodologia: '',
    planoDivulgacao: '',
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

      // Carregar lista de modalidades global
      try {
        const snap = await getDocs(collection(db, 'modalidades'));
        if (snap.empty) {
          // Coleção vazia, popular com a lista padrão
          const batch = writeBatch(db);
          const listaPadrao = [
            'Atletismo', 'Badminton', 'Basquete 3x3', 'Basquete em Cadeira', 'Basquetebol',
            'Beach Tennis', 'Bocha', 'Boxe', 'Ciclismo', 'Damas', 'Esgrima',
            'Futebol', 'Futsal', 'Ginástica Artística', 'Ginástica Rítmica',
            'Handebol', 'Judô', 'Karatê', 'Natação', 'Paralímpico Goalball',
            'Remo Virtual', 'Skate', 'Taekwondo', 'Tênis de Mesa', 'Tênis em Cadeira',
            'Tiro com Arco', 'Triatlhon', 'Vôlei de Praia', 'Volei Sentado', 'Voleibol',
            'Wrestling', 'Xadrez'
          ];
          listaPadrao.forEach(mod => {
            batch.set(doc(db, 'modalidades', mod), { nome: mod });
          });
          await batch.commit();
          setModalidadesLista(listaPadrao.sort());
        } else {
          const list = snap.docs.map(d => d.data().nome as string);
          list.sort((a, b) => a.localeCompare(b, 'pt-BR'));
          setModalidadesLista(list);
        }
      } catch (e) {
        console.error("Erro ao carregar lista de modalidades", e);
      }

      if (!isNew && id) {
        try {
          const snap = await getDoc(doc(db, 'projects', id));
          if (snap.exists()) {
            const data = snap.data() as Projeto;
            setFormData(data);
            setOriginalPeriod({ mesInicio: data.mesInicio, mesTermino: data.mesTermino });
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

  const addModalidade = () => {
    if (!selectedMod) return;
    const already = (formData.modalidades || []).find(m => m.nome === selectedMod);
    if (already) return;
    const newMod: ModalidadeProjeto = { nome: selectedMod, paralimpica: false };
    setFormData(prev => ({ ...prev, modalidades: [...(prev.modalidades || []), newMod] }));
    setSelectedMod('');
  };

  const removeModalidade = (nome: string) => {
    setFormData(prev => ({ ...prev, modalidades: (prev.modalidades || []).filter(m => m.nome !== nome) }));
  };

  const toggleParalimpica = (nome: string) => {
    setFormData(prev => ({
      ...prev,
      modalidades: (prev.modalidades || []).map(m =>
        m.nome === nome ? { ...m, paralimpica: !m.paralimpica } : m
      )
    }));
  };

  const handleAddModalidadeGlobal = async () => {
    const nome = novaModalidadeGlobal.trim();
    if (!nome) return;
    
    // Verificar se já existe
    if (modalidadesLista.some(m => m.toLowerCase() === nome.toLowerCase())) {
      alert("Esta modalidade já existe na lista.");
      return;
    }

    setSavingModGlobal(true);
    try {
      await setDoc(doc(db, 'modalidades', nome), { nome });
      setNovaModalidadeGlobal('');
      
      // Atualizar lista
      const updated = [...modalidadesLista, nome].sort((a, b) => a.localeCompare(b, 'pt-BR'));
      setModalidadesLista(updated);
    } catch (e) {
      console.error(e);
      alert("Erro ao adicionar modalidade.");
    } finally {
      setSavingModGlobal(false);
    }
  };

  const handleRemoveModalidadeGlobal = async (nome: string) => {
    if (!confirm(`Tem certeza que deseja excluir a modalidade "${nome}" da lista global? Isso apenas removerá a opção para novos cadastros e não alterará os projetos existentes.`)) return;
    
    try {
      await deleteDoc(doc(db, 'modalidades', nome));
      
      // Atualizar lista
      const updated = modalidadesLista.filter(m => m !== nome);
      setModalidadesLista(updated);
    } catch (e) {
      console.error(e);
      alert("Erro ao excluir modalidade.");
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

      // Salvaguardas se as datas mudaram
      const dateChanged = !isNew && (formData.mesInicio !== originalPeriod.mesInicio || formData.mesTermino !== originalPeriod.mesTermino);
      
      if (dateChanged) {
        // 1. Verificar se há fornecedores vinculados nos itens
        const itemsSnap = await getDocs(collection(db, `projects/${projId}/items`));
        let temFornecedores = false;
        itemsSnap.forEach(itemDoc => {
          const itemData = itemDoc.data();
          if (itemData.fornecedoresIds && itemData.fornecedoresIds.length > 0) {
            temFornecedores = true;
          }
        });

        // 2. Verificar se há registros na execução mensal com quantidades informadas ou arquivos
        const execSnap = await getDocs(collection(db, `projects/${projId}/execucao`));
        let temExecucao = false;
        execSnap.forEach(execDoc => {
          const execData = execDoc.data();
          if (execData.itens && execData.itens.length > 0) {
            execData.itens.forEach((item: any) => {
              if (item.fornecedoresExecucao && item.fornecedoresExecucao.length > 0) {
                item.fornecedoresExecucao.forEach((f: any) => {
                  if (f.quantidade > 0 || f.notaFiscalUrl || f.comprovanteUrl || f.extratoBancarioUrl) {
                    temExecucao = true;
                  }
                });
              }
            });
          }
        });

        if (temFornecedores || temExecucao) {
          alert("Você possui o módulo Execução preenchido neste projeto, por isso não é possível alterar o período de execução.");
          setSaving(false);
          return;
        }

        // 3. Verificar se há cronograma cadastrado
        const cronSnap = await getDocs(collection(db, `projects/${projId}/cronograma`));
        const temCronograma = !cronSnap.empty;

        if (temCronograma) {
          const confirmar = window.confirm(
            "Este projeto já possui Cronograma de Execução, se continuar com a alteração de período, o cronograma de execução será apagado e deverá ser cadastrado novamente. Deseja continuar?"
          );
          if (!confirmar) {
            setSaving(false);
            return;
          }

          // Se clicar em SIM, resetar/deletar a subcoleção cronograma
          const batch = writeBatch(db);
          cronSnap.forEach(cronDoc => {
            batch.delete(cronDoc.ref);
          });
          await batch.commit();
        }
      }

      const payload = {
        ...formData,
        duracaoMeses: calculateStages(),
        atualizadoEm: serverTimestamp(),
      };
      if (isNew) (payload as any).criadoEm = serverTimestamp();
      await setDoc(doc(db, 'projects', projId), payload, { merge: true });
      
      // Atualizar o originalPeriod com as novas datas se for uma edição
      if (!isNew) {
        setOriginalPeriod({ mesInicio: formData.mesInicio, mesTermino: formData.mesTermino });
      }

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

  const confirmConsolidar = async (options: PrintOptions) => {
    setModalOpen(false);
    setConsolidando(true);
    try {
      await consolidarProjeto(id!, options);
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
      {!isNew && id && <ProjetoWorkspaceNav projetoId={id} active="plano" status={formData.status} />}
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
              onClick={handleConsolidar} 
              disabled={consolidando}
              className="flex items-center gap-2 bg-lie-ink hover:bg-lie-ink/90 text-white rounded-lg px-3 py-2 transition-all duration-300 shadow-sm"
              title="Visualizar Impressão (PDF)"
            >
              {consolidando ? <Loader2 className="w-5 h-5 animate-spin shrink-0" /> : <Printer className="w-5 h-5 shrink-0" />}
              <span className="font-medium whitespace-nowrap">
                Visualizar Impressão
              </span>
            </button>
            <button 
              type="button"
              onClick={() => setIsEditing(true)} 
              className="group flex items-center bg-lie-green text-white rounded-lg p-2 transition-all duration-300 overflow-hidden hover:bg-lie-greenDark shadow-sm"
            >
              <Edit3 className="w-5 h-5 shrink-0" />
              <span className="max-w-0 opacity-0 group-hover:max-w-xs group-hover:opacity-100 group-hover:ml-2 whitespace-nowrap transition-all duration-300 ease-in-out font-medium">
                Editar Projeto
              </span>
            </button>
          </div>
        )}
        {isEditing && (
          <div className="flex gap-2">
            {!isNew && (
              <button 
                type="button" 
                onClick={() => setIsEditing(false)} 
                className="group flex items-center bg-white border border-gray-300 text-gray-700 rounded-lg p-2 transition-all duration-300 overflow-hidden hover:bg-gray-100 shadow-sm"
              >
                <X className="w-5 h-5 shrink-0" />
                <span className="max-w-0 opacity-0 group-hover:max-w-xs group-hover:opacity-100 group-hover:ml-2 whitespace-nowrap transition-all duration-300 ease-in-out font-medium">
                  Cancelar
                </span>
              </button>
            )}
            <button 
              type="submit" 
              form="projeto-form"
              disabled={saving} 
              className="group flex items-center bg-lie-green text-white rounded-lg p-2 transition-all duration-300 overflow-hidden hover:bg-lie-greenDark shadow-sm"
            >
              <Save className="w-5 h-5 shrink-0" />
              <span className="max-w-0 opacity-0 group-hover:max-w-xs group-hover:opacity-100 group-hover:ml-2 whitespace-nowrap transition-all duration-300 ease-in-out font-medium">
                {saving ? 'Salvando...' : 'Salvar Projeto'}
              </span>
            </button>
          </div>
        )}
      </header>

      {!isNew && (
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-violet-50 border border-violet-200 rounded-xl p-3">
          <div className="flex items-start gap-2 text-sm text-violet-900">
            <Sparkles className="w-5 h-5 text-violet-600 shrink-0 mt-0.5" />
            <span><strong>Assistente de IA:</strong> gera resumo, objetivos, justificativa, caracterização e metodologia a partir do histórico da entidade e de um brief curto.</span>
          </div>
          <button
            type="button"
            onClick={() => setAssistenteOpen(true)}
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 rounded-lg font-bold shadow-sm whitespace-nowrap shrink-0"
          >
            <Sparkles className="w-4 h-4" /> Gerar com IA
          </button>
        </div>
      )}

      {assistenteOpen && (
        <AssistentePlanoModal
          projeto={formData}
          onClose={() => setAssistenteOpen(false)}
          onApply={aplicarPlanoIA}
        />
      )}

      <form id="projeto-form" onSubmit={handleSubmit} className="space-y-8">
        
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
              <label className="block text-sm font-semibold text-gray-700 mb-1">Status do Projeto *</label>
              <select
                name="status"
                required
                value={formData.status || 'em_elaboracao'}
                onChange={handleChange}
                disabled={!isEditing}
                className={inputCls}
              >
                <option value="em_elaboracao">Em Elaboração</option>
                <option value="em_captacao">Em Captação</option>
                <option value="aprovado">Aprovado</option>
                <option value="em_execucao">Em Execução</option>
                <option value="reprovado">Reprovado</option>
                <option value="diligencias">Diligências</option>
                <option value="cancelado">Cancelado</option>
                {formData.status && !['em_elaboracao', 'em_captacao', 'aprovado', 'em_execucao', 'reprovado', 'diligencias', 'cancelado'].includes(formData.status) && (
                  <option value={formData.status}>
                    {formData.status === 'em_analise' ? 'Em Análise' :
                     formData.status === 'em_prestacao_contas' ? 'Em Prestação de Contas' :
                     formData.status === 'concluido' ? 'Concluído' :
                     formData.status === 'arquivado' ? 'Arquivado' : formData.status}
                  </option>
                )}
              </select>
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
              <AutoResizeTextarea name="resumo" minRows={5} value={formData.resumo} onChange={handleChange} disabled={!isEditing} className={inputCls} />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-semibold text-gray-700 mb-1">Plano de Divulgação</label>
              <AutoResizeTextarea name="planoDivulgacao" minRows={5} value={(formData as any).planoDivulgacao || ''} onChange={handleChange} disabled={!isEditing} className={inputCls} placeholder="Descreva como o projeto será divulgado..." />
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

        {/* Modalidades */}
        <section className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
          <div className="flex items-center gap-2 mb-4 border-b border-gray-50 pb-2">
            <Target className="w-5 h-5 text-lie-green" />
            <h2 className="text-lg font-bold text-lie-ink">Modalidades</h2>
          </div>
          <div className="space-y-4">
            {/* Selector row */}
            {isEditing && (
              <div className="flex gap-2">
                <select
                  value={selectedMod}
                  onChange={e => setSelectedMod(e.target.value)}
                  className={inputCls + ' flex-1'}
                >
                  <option value="">Selecione uma modalidade...</option>
                  {modalidadesLista.filter(m => !(formData.modalidades || []).find(x => x.nome === m)).map(mod => (
                    <option key={mod} value={mod}>{mod}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={addModalidade}
                  disabled={!selectedMod}
                  className="p-2 bg-lie-green text-white rounded-lg hover:bg-lie-greenDark disabled:opacity-40 disabled:cursor-not-allowed transition"
                  title="Adicionar modalidade ao projeto"
                >
                  <Plus className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  onClick={() => setIsManagingModalidades(true)}
                  className="p-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 transition flex items-center justify-center"
                  title="Gerenciar lista global de modalidades"
                >
                  <Settings className="w-5 h-5 shrink-0" />
                </button>
              </div>
            )}

            {/* Lista de modalidades selecionadas */}
            {(formData.modalidades || []).length === 0 ? (
              <p className="text-sm text-gray-400 italic">{isEditing ? 'Nenhuma modalidade adicionada.' : 'Sem modalidades cadastradas.'}</p>
            ) : (
              <div className="space-y-2">
                {(formData.modalidades || []).map(mod => (
                  <div key={mod.nome} className="flex items-center justify-between gap-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
                    <span className="text-sm font-medium text-lie-ink">{mod.nome}</span>
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={mod.paralimpica}
                          onChange={() => isEditing && toggleParalimpica(mod.nome)}
                          disabled={!isEditing}
                          className="rounded border-gray-300 text-lie-green focus:ring-lie-green"
                        />
                        Paralímpica
                      </label>
                      {isEditing && (
                        <button
                          type="button"
                          onClick={() => removeModalidade(mod.nome)}
                          className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded"
                          title="Remover"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
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
              <AutoResizeTextarea name="objetivoGeral" minRows={3} required value={formData.objetivoGeral} onChange={handleChange} disabled={!isEditing} className={inputCls} />
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
              <AutoResizeTextarea name="justificativa" minRows={6} required value={formData.justificativa} onChange={handleChange} disabled={!isEditing} className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Caracterização Socioeconômica (IDH, Região) *</label>
              <AutoResizeTextarea name="caracterizacaoSocioeconomica" minRows={5} required value={formData.caracterizacaoSocioeconomica} onChange={handleChange} disabled={!isEditing} className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Metodologia de Aplicação *</label>
              <AutoResizeTextarea name="metodologia" minRows={6} required value={formData.metodologia} onChange={handleChange} disabled={!isEditing} className={inputCls} />
            </div>
          </div>
        </section>

        {/* Cronograma */}
        <section className="bg-white rounded-xl shadow-sm p-6 border border-gray-100 overflow-hidden">
          <div className="flex items-center gap-2 mb-4 border-b border-gray-50 pb-2">
            <Calendar className="w-5 h-5 text-lie-green" />
            <h2 className="text-lg font-bold text-lie-ink">Cronograma Previsto</h2>
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
            {isEditing && (
              <div className="p-3 border-t border-gray-100">
                <button type="button" onClick={addAcao} className="inline-flex items-center gap-2 bg-lie-green text-white px-3 py-1.5 rounded-lg text-sm font-bold">
                  <Plus className="w-4 h-4" /> Adicionar Ação
                </button>
              </div>
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

      </form>

      <PrintOptionsModal 
        isOpen={modalOpen} 
        onClose={() => setModalOpen(false)} 
        onConfirm={confirmConsolidar}
        title="Gerar Relatório PDF"
      />

      {isManagingModalidades && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full max-h-[80vh] flex flex-col overflow-hidden text-left">
            <header className="px-6 py-4 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-lie-ink">Gerenciar Modalidades</h3>
                <p className="text-sm text-lie-gray">Adicione ou exclua da lista global do sistema</p>
              </div>
              <button 
                type="button"
                onClick={() => setIsManagingModalidades(false)}
                className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition"
              >
                <X className="w-6 h-6" />
              </button>
            </header>

            <div className="p-6 flex-1 overflow-y-auto space-y-4">
              {/* Formulário para adicionar nova */}
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Nome da modalidade (ex: Caratê)"
                  value={novaModalidadeGlobal}
                  onChange={e => setNovaModalidadeGlobal(e.target.value)}
                  className="flex-1 border-gray-300 rounded-lg shadow-sm focus:ring-lie-green focus:border-lie-green text-sm"
                />
                <button
                  type="button"
                  onClick={handleAddModalidadeGlobal}
                  disabled={savingModGlobal || !novaModalidadeGlobal.trim()}
                  className="px-4 py-2 bg-lie-green hover:bg-lie-greenDark text-white text-sm font-semibold rounded-lg disabled:opacity-50 transition"
                >
                  Adicionar
                </button>
              </div>

              {/* Lista global */}
              <div className="border border-gray-100 rounded-xl overflow-hidden shadow-sm">
                <div className="max-h-[40vh] overflow-y-auto divide-y divide-gray-100">
                  {modalidadesLista.map(mod => (
                    <div key={mod} className="flex items-center justify-between p-3 hover:bg-gray-50">
                      <span className="text-sm font-medium text-lie-ink">{mod}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveModalidadeGlobal(mod)}
                        className="p-1 text-red-500 hover:bg-red-50 rounded transition"
                        title="Excluir modalidade da lista global"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  {modalidadesLista.length === 0 && (
                    <div className="p-6 text-center text-gray-400 italic text-sm">Nenhuma modalidade cadastrada.</div>
                  )}
                </div>
              </div>
            </div>

            <footer className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end">
              <button
                type="button"
                onClick={() => setIsManagingModalidades(false)}
                className="px-5 py-2 border border-gray-300 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-100 transition shadow-sm"
              >
                Fechar
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}

const Edit3 = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>;
