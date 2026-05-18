import { useEffect, useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, getDoc, setDoc, serverTimestamp, collection, getDocs, orderBy, query } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Save, ArrowLeft, Image as ImageIcon, MapPin, Building2, Phone, Mail, FileText, Globe, Plus, Trash2, X, Users, Edit3, AlertTriangle } from 'lucide-react';
import { db, storage } from '../lib/firebase';
import { deleteDoc } from 'firebase/firestore';
import { fetchCep } from '../lib/cep';
import type { Entidade } from '../types';

const maskCep = (v: string) => {
  v = v.replace(/\D/g, '');
  v = v.replace(/(\d{5})(\d)/, '$1-$2');
  return v.substring(0, 9);
};

const maskCnpj = (v: string) => {
  v = v.replace(/\D/g, "");
  v = v.replace(/^(\d{2})(\d)/, "$1.$2");
  v = v.replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3");
  v = v.replace(/\.(\d{3})(\d)/, ".$1/$2");
  v = v.replace(/(\d{4})(\d)/, "$1-$2");
  return v.substring(0, 18);
};

const maskCpf = (v: string) => {
  v = v.replace(/\D/g, "");
  v = v.replace(/(\d{3})(\d)/, "$1.$2");
  v = v.replace(/(\d{3})(\d)/, "$1.$2");
  v = v.replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  return v.substring(0, 14);
};

const maskPhone = (v: string) => {
  v = v.replace(/\D/g, "");
  v = v.replace(/^(\d{2})(\d)/g, "($1) $2");
  v = v.replace(/(\d)(\d{4})$/, "$1-$2");
  return v.substring(0, 15);
};

export default function EntidadeFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id || id === 'nova';

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [isEditing, setIsEditing] = useState(isNew);
  const [docsVencidos, setDocsVencidos] = useState(0);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState<Partial<Entidade>>({
    tipo: 'proponente', // Valor padrão escondido
    nome: '',
    sigla: '',
    cnpj: '',
    logoUrl: '',
    corPredominante: '#16A34A',
    cep: '',
    logradouro: '',
    numero: '',
    complemento: '',
    bairro: '',
    cidade: '',
    uf: '',
    email: '',
    telefones: [''], 
    site: '',
    instagram: '',
    facebook: '',
    tiktok: '',
    youtube: '',
    linkedin: '',
    responsavelLegal: {
      nome: '',
      cargo: '',
      cpf: '',
      email: '',
      telefone: ''
    },
    historico: '',
    capacidadeTecnica: ''
  });

  useEffect(() => {
    if (!isNew && id) {
      (async () => {
        try {
          const docRef = doc(db, 'entities', id);
          const snap = await getDoc(docRef);
          if (snap.exists()) {
            const data = snap.data() as Entidade;
            if (!data.telefones || data.telefones.length === 0) data.telefones = [''];
            if (!data.responsavelLegal) data.responsavelLegal = { nome: '' };
            setFormData(data);
          } else {
            navigate('/entidades');
          }
          // Conta documentos vencidos/inativos
          const docsSnap = await getDocs(query(collection(db, `entities/${id}/documentos`)));
          const now = new Date();
          let count = 0;
          docsSnap.forEach(d => {
            const val = d.data().validade;
            if (val) {
              const dt = val.toDate ? val.toDate() : new Date(val);
              if (dt.getTime() < now.getTime()) count++;
            }
          });
          setDocsVencidos(count);
        } finally {
          setLoading(false);
        }
      })();
    }
  }, [id, isNew, navigate]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    let { name, value } = e.target;

    // Apply masks
    if (name === 'cnpj') value = maskCnpj(value);
    if (name === 'cep') value = maskCep(value);
    if (name === 'resp_cpf') value = maskCpf(value);
    if (name === 'resp_telefone') value = maskPhone(value);

    if (name.startsWith('resp_')) {
      const field = name.replace('resp_', '');
      setFormData(prev => ({
        ...prev,
        responsavelLegal: { ...prev.responsavelLegal!, [field]: value }
      }));
    } else {
      setFormData(prev => ({ ...prev, [name]: value }));
    }
  };

  const handlePhoneChange = (index: number, value: string) => {
    const newPhones = [...(formData.telefones || [])];
    newPhones[index] = maskPhone(value);
    setFormData(prev => ({ ...prev, telefones: newPhones }));
  };

  const addPhone = () => setFormData(prev => ({ ...prev, telefones: [...(prev.telefones || []), ''] }));
  
  const removePhone = (index: number) => {
    const newPhones = [...(formData.telefones || [])];
    newPhones.splice(index, 1);
    setFormData(prev => ({ ...prev, telefones: newPhones }));
  };

  const handleCepBlur = async () => {
    if (formData.cep && formData.cep.replace(/\D/g, '').length >= 8) {
      const data = await fetchCep(formData.cep);
      if (data) {
        setFormData(prev => ({
          ...prev,
          logradouro: data.logradouro,
          bairro: data.bairro,
          cidade: data.localidade,
          uf: data.uf
        }));
      }
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Verificar tamanho (max 2MB para não pesar muito no Firestore)
    if (!file.type.match(/image\/(png|jpeg|jpg)/)) {
      alert("Formato não aceito. Use PNG, JPG ou JPEG.");
      return;
    }

    if (file.size > 1024 * 1024) {
      alert("A imagem é muito grande (máximo 1MB).");
      return;
    }

    setUploadingLogo(true);
    try {
      const storageRef = ref(storage, `logos/entidades/${Date.now()}_${file.name}`);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      setFormData(prev => ({ ...prev, logoUrl: url }));
    } catch (err) {
      console.error(err);
      alert("Erro ao subir imagem.");
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const entityId = isNew ? doc(collection(db, 'entities')).id : id!;
      const docRef = doc(db, 'entities', entityId);
      
      const payload = {
        ...formData,
        atualizadoEm: serverTimestamp()
      };

      if (isNew) payload.criadoEm = serverTimestamp();

      payload.telefones = payload.telefones?.filter(t => t.trim() !== '') || [];

      await setDoc(docRef, payload, { merge: true });
      setIsEditing(false);
      if (isNew) {
        navigate(`/entidades/${entityId}`, { replace: true });
      }
    } catch (error) {
      console.error("Erro ao salvar", error);
      alert("Ocorreu um erro ao salvar a entidade.");
    } finally {
      setSaving(false);
    }
  };

  const handleExcluir = async () => {
    if (!id || isNew) return;
    if (!confirm("Tem certeza que deseja excluir esta entidade permanentemente?")) return;
    
    try {
      setSaving(true);
      await deleteDoc(doc(db, 'entities', id));
      navigate('/entidades');
    } catch (err) {
      console.error(err);
      alert("Erro ao excluir entidade.");
      setSaving(false);
    }
  };

  if (loading) return <div className="p-6 text-lie-gray">Carregando…</div>;

  return (
    <div className="p-6 max-w-4xl mx-auto pb-24">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/entidades')} className="p-2 text-lie-gray hover:bg-gray-100 rounded-lg">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-4">
            {formData.logoUrl ? (
              <img src={formData.logoUrl} alt="Logo" className="w-16 h-16 rounded-lg object-contain bg-white shadow-sm" />
            ) : (
              <div className="w-16 h-16 rounded-lg bg-gray-200 flex items-center justify-center text-gray-400 shadow-sm">
                <ImageIcon className="w-8 h-8" />
              </div>
            )}
            <div>
              <h1 className="text-2xl font-bold text-lie-ink">
                {isNew ? 'Nova Entidade' : (formData.sigla || formData.nome || 'Entidade')}
              </h1>
              {!isNew && formData.sigla && (
                <p className="text-sm text-lie-gray">{formData.nome}</p>
              )}
              {!isNew && <p className="text-sm text-lie-gray">CNPJ: {formData.cnpj}</p>}
            </div>
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          {!isNew && !isEditing && (
            <button 
              type="button"
              onClick={() => setIsEditing(true)}
              className="group flex items-center bg-lie-green text-white rounded-lg p-2 transition-all duration-300 overflow-hidden hover:bg-lie-greenDark shadow-sm"
            >
              <Edit3 className="w-5 h-5 shrink-0" />
              <span className="max-w-0 opacity-0 group-hover:max-w-xs group-hover:opacity-100 group-hover:ml-2 whitespace-nowrap transition-all duration-300 ease-in-out font-medium">
                Editar Cadastro
              </span>
            </button>
          )}
          {!isNew && (
            <>
              <button 
                type="button"
                onClick={() => navigate(`/entidades/${id}/documentos`)}
                className="group flex items-center bg-white border border-gray-300 text-amber-600 rounded-lg p-2 transition-all duration-300 overflow-hidden hover:bg-amber-50 shadow-sm"
              >
                <FileText className="w-5 h-5 shrink-0" />
                <span className="max-w-0 opacity-0 group-hover:max-w-xs group-hover:opacity-100 group-hover:ml-2 whitespace-nowrap transition-all duration-300 ease-in-out font-medium">
                  Documentos
                </span>
              </button>
              <button 
                type="button"
                onClick={() => navigate(`/entidades/${id}/dirigentes`)}
                className="group flex items-center bg-white border border-gray-300 text-blue-600 rounded-lg p-2 transition-all duration-300 overflow-hidden hover:bg-blue-50 shadow-sm"
              >
                <Users className="w-5 h-5 shrink-0" />
                <span className="max-w-0 opacity-0 group-hover:max-w-xs group-hover:opacity-100 group-hover:ml-2 whitespace-nowrap transition-all duration-300 ease-in-out font-medium">
                  Dirigentes
                </span>
              </button>
            </>
          )}
          {isEditing && !isNew && (
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
          {isEditing && !isNew && (
            <button 
              type="button" 
              onClick={handleExcluir} 
              className="group flex items-center bg-white border border-red-200 text-red-500 rounded-lg p-2 transition-all duration-300 overflow-hidden hover:bg-red-50 shadow-sm"
            >
              <Trash2 className="w-5 h-5 shrink-0" />
              <span className="max-w-0 opacity-0 group-hover:max-w-xs group-hover:opacity-100 group-hover:ml-2 whitespace-nowrap transition-all duration-300 ease-in-out font-medium">
                Excluir
              </span>
            </button>
          )}
          {isEditing && (
            <button 
              type="submit" 
              form="entidade-form"
              disabled={saving} 
              className="group flex items-center bg-lie-green text-white rounded-lg p-2 transition-all duration-300 overflow-hidden hover:bg-lie-greenDark shadow-sm"
            >
              <Save className="w-5 h-5 shrink-0" />
              <span className="max-w-0 opacity-0 group-hover:max-w-xs group-hover:opacity-100 group-hover:ml-2 whitespace-nowrap transition-all duration-300 ease-in-out font-medium">
                {saving ? 'Salvando...' : 'Salvar'}
              </span>
            </button>
          )}
        </div>
      </header>

      {/* Alerta de documentos vencidos/inativos */}
      {!isNew && docsVencidos > 0 && (
        <div className="mb-4 flex items-center gap-3 bg-amber-50 border border-amber-300 text-amber-800 rounded-lg px-4 py-3">
          <AlertTriangle className="w-5 h-5 shrink-0 text-amber-500" />
          <span className="text-sm font-medium">
            Atenção: esta entidade possui <strong>{docsVencidos}</strong> documento{docsVencidos > 1 ? 's' : ''} vencido{docsVencidos > 1 ? 's' : ''}/inativo{docsVencidos > 1 ? 's' : ''}.
          </span>
          <button
            type="button"
            onClick={() => navigate(`/entidades/${id}/documentos`)}
            className="ml-auto text-xs font-semibold underline hover:text-amber-900 whitespace-nowrap"
          >
            Ver documentos
          </button>
        </div>
      )}

      <form id="entidade-form" onSubmit={handleSubmit} className="space-y-6">
        
        {/* Dados Principais */}
        <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
          <h2 className="text-lg font-semibold text-lie-ink mb-4">Dados Principais</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            
            {isEditing && (
              <div className="md:col-span-2 flex flex-col items-start gap-2 mb-2">
                <label className="block text-sm font-medium text-gray-700">Logo da Entidade</label>
                <div className="flex items-center gap-4">
                  {formData.logoUrl && (
                    <div className="relative">
                      <img src={formData.logoUrl} alt="Logo preview" className="w-16 h-16 rounded object-contain border" />
                      <button type="button" onClick={() => setFormData(p => ({...p, logoUrl: ''}))} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow-sm">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                  <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={handleLogoUpload} />
                  <button 
                    type="button" 
                    onClick={() => fileInputRef.current?.click()} 
                    disabled={uploadingLogo}
                    className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 text-gray-700 transition"
                  >
                    <ImageIcon className="w-4 h-4" /> {uploadingLogo ? 'Enviando...' : formData.logoUrl ? 'Trocar Imagem' : 'Selecionar Imagem'}
                  </button>
                  <p className="text-[10px] text-gray-400 mt-1 uppercase font-bold tracking-wider">PNG, JPG ou JPEG • Máximo 1MB</p>
                </div>
              </div>
            )}

            {/* Cor Predominante — sempre visível, mas editável só no modo edição */}
            <div className="md:col-span-2 flex flex-col gap-2">
              <label className="block text-sm font-medium text-gray-700">Cor Predominante da Entidade</label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  name="corPredominante"
                  value={formData.corPredominante || '#16A34A'}
                  onChange={handleChange}
                  disabled={!isEditing}
                  className="w-12 h-10 rounded-lg border border-gray-300 cursor-pointer disabled:cursor-not-allowed p-0.5"
                />
                <div
                  className="flex-1 h-10 rounded-lg border border-gray-200 shadow-inner"
                  style={{ background: `linear-gradient(90deg, ${formData.corPredominante || '#16A34A'}22, ${formData.corPredominante || '#16A34A'})` }}
                />
                <span className="text-sm font-mono text-gray-600 w-20">{formData.corPredominante || '#16A34A'}</span>
              </div>
              <p className="text-xs text-gray-400">Esta cor será usada na capa e tabelas do Dossiê PDF.</p>
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Nome Completo / Razão Social *</label>
              <input type="text" name="nome" required value={formData.nome} onChange={handleChange} disabled={!isEditing} className="w-full border-gray-300 rounded-lg shadow-sm disabled:bg-gray-50 disabled:text-gray-500 focus:ring-lie-green focus:border-lie-green" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Sigla</label>
              <input type="text" name="sigla" value={formData.sigla} onChange={handleChange} disabled={!isEditing} className="w-full border-gray-300 rounded-lg shadow-sm disabled:bg-gray-50 disabled:text-gray-500 focus:ring-lie-green focus:border-lie-green" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">CNPJ *</label>
              <input type="text" name="cnpj" required placeholder="00.000.000/0001-00" value={formData.cnpj} onChange={handleChange} disabled={!isEditing} className="w-full border-gray-300 rounded-lg shadow-sm disabled:bg-gray-50 disabled:text-gray-500 focus:ring-lie-green focus:border-lie-green" />
            </div>
          </div>
        </div>

        {/* Endereço */}
        <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
          <h2 className="text-lg font-semibold text-lie-ink mb-4">Endereço</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">CEP</label>
              <input type="text" name="cep" value={formData.cep} onChange={handleChange} onBlur={handleCepBlur} disabled={!isEditing} className="w-full border-gray-300 rounded-lg shadow-sm disabled:bg-gray-50 disabled:text-gray-500 focus:ring-lie-green focus:border-lie-green" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Endereço (Logradouro)</label>
              <input type="text" name="logradouro" value={formData.logradouro} onChange={handleChange} disabled={!isEditing} className="w-full border-gray-300 rounded-lg shadow-sm disabled:bg-gray-50 disabled:text-gray-500 focus:ring-lie-green focus:border-lie-green" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Número</label>
              <input type="text" name="numero" value={formData.numero} onChange={handleChange} disabled={!isEditing} className="w-full border-gray-300 rounded-lg shadow-sm disabled:bg-gray-50 disabled:text-gray-500 focus:ring-lie-green focus:border-lie-green" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Complemento</label>
              <input type="text" name="complemento" value={formData.complemento} onChange={handleChange} disabled={!isEditing} className="w-full border-gray-300 rounded-lg shadow-sm disabled:bg-gray-50 disabled:text-gray-500 focus:ring-lie-green focus:border-lie-green" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Bairro</label>
              <input type="text" name="bairro" value={formData.bairro} onChange={handleChange} disabled={!isEditing} className="w-full border-gray-300 rounded-lg shadow-sm disabled:bg-gray-50 disabled:text-gray-500 focus:ring-lie-green focus:border-lie-green" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Cidade</label>
              <input type="text" name="cidade" value={formData.cidade} onChange={handleChange} disabled={!isEditing} className="w-full border-gray-300 rounded-lg shadow-sm disabled:bg-gray-50 disabled:text-gray-500 focus:ring-lie-green focus:border-lie-green" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">UF</label>
              <input type="text" name="uf" maxLength={2} value={formData.uf} onChange={handleChange} disabled={!isEditing} className="w-full border-gray-300 rounded-lg shadow-sm disabled:bg-gray-50 disabled:text-gray-500 focus:ring-lie-green focus:border-lie-green uppercase" />
            </div>
          </div>
        </div>

        {/* Contatos */}
        <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
          <h2 className="text-lg font-semibold text-lie-ink mb-4">Contatos e Redes Sociais</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">E-mail da Entidade</label>
              <input type="email" name="email" value={formData.email} onChange={handleChange} disabled={!isEditing} className="w-full border-gray-300 rounded-lg shadow-sm disabled:bg-gray-50 disabled:text-gray-500 focus:ring-lie-green focus:border-lie-green" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Telefones</label>
              {formData.telefones?.map((tel, index) => (
                <div key={index} className="flex items-center gap-2 mb-2">
                  <input type="text" value={tel} onChange={(e) => handlePhoneChange(index, e.target.value)} disabled={!isEditing} placeholder="(00) 00000-0000" className="flex-1 border-gray-300 rounded-lg shadow-sm disabled:bg-gray-50 disabled:text-gray-500 focus:ring-lie-green focus:border-lie-green" />
                  {isEditing && index > 0 && (
                    <button type="button" onClick={() => removePhone(index)} className="text-red-500 text-sm px-2 font-medium hover:bg-red-50 rounded transition">Remover</button>
                  )}
                </div>
              ))}
              {isEditing && (
                <button type="button" onClick={addPhone} className="text-lie-green text-sm font-medium mt-1 hover:underline">+ Adicionar outro telefone</button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Site</label><input type="text" name="site" value={formData.site} onChange={handleChange} disabled={!isEditing} className="w-full border-gray-300 rounded-lg shadow-sm disabled:bg-gray-50 disabled:text-gray-500" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Instagram</label><input type="text" name="instagram" value={formData.instagram} onChange={handleChange} disabled={!isEditing} className="w-full border-gray-300 rounded-lg shadow-sm disabled:bg-gray-50 disabled:text-gray-500" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Facebook</label><input type="text" name="facebook" value={formData.facebook} onChange={handleChange} disabled={!isEditing} className="w-full border-gray-300 rounded-lg shadow-sm disabled:bg-gray-50 disabled:text-gray-500" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">LinkedIn</label><input type="text" name="linkedin" value={formData.linkedin} onChange={handleChange} disabled={!isEditing} className="w-full border-gray-300 rounded-lg shadow-sm disabled:bg-gray-50 disabled:text-gray-500" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">YouTube</label><input type="text" name="youtube" value={formData.youtube} onChange={handleChange} disabled={!isEditing} className="w-full border-gray-300 rounded-lg shadow-sm disabled:bg-gray-50 disabled:text-gray-500" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">TikTok</label><input type="text" name="tiktok" value={formData.tiktok} onChange={handleChange} disabled={!isEditing} className="w-full border-gray-300 rounded-lg shadow-sm disabled:bg-gray-50 disabled:text-gray-500" /></div>
          </div>
        </div>

        {/* Responsável Legal */}
        <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
          <h2 className="text-lg font-semibold text-lie-ink mb-4">Responsável Legal</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Nome Completo</label>
              <input type="text" name="resp_nome" value={formData.responsavelLegal?.nome} onChange={handleChange} disabled={!isEditing} className="w-full border-gray-300 rounded-lg shadow-sm disabled:bg-gray-50 disabled:text-gray-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Cargo</label>
              <input type="text" name="resp_cargo" value={formData.responsavelLegal?.cargo} onChange={handleChange} disabled={!isEditing} className="w-full border-gray-300 rounded-lg shadow-sm disabled:bg-gray-50 disabled:text-gray-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">CPF</label>
              <input type="text" name="resp_cpf" placeholder="000.000.000-00" value={formData.responsavelLegal?.cpf} onChange={handleChange} disabled={!isEditing} className="w-full border-gray-300 rounded-lg shadow-sm disabled:bg-gray-50 disabled:text-gray-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">E-mail</label>
              <input type="email" name="resp_email" value={formData.responsavelLegal?.email} onChange={handleChange} disabled={!isEditing} className="w-full border-gray-300 rounded-lg shadow-sm disabled:bg-gray-50 disabled:text-gray-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Telefone</label>
              <input type="text" name="resp_telefone" placeholder="(00) 00000-0000" value={formData.responsavelLegal?.telefone} onChange={handleChange} disabled={!isEditing} className="w-full border-gray-300 rounded-lg shadow-sm disabled:bg-gray-50 disabled:text-gray-500" />
            </div>
          </div>
        </div>

        {/* Informações Complementares */}
        <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
          <h2 className="text-lg font-semibold text-lie-ink mb-4">Informações Complementares</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Histórico da Entidade</label>
              <textarea name="historico" rows={4} value={formData.historico} onChange={handleChange} disabled={!isEditing} className="w-full border-gray-300 rounded-lg shadow-sm disabled:bg-gray-50 disabled:text-gray-500"></textarea>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Capacidade Técnica e Operacional</label>
              <textarea name="capacidadeTecnica" rows={4} value={formData.capacidadeTecnica} onChange={handleChange} disabled={!isEditing} className="w-full border-gray-300 rounded-lg shadow-sm disabled:bg-gray-50 disabled:text-gray-500"></textarea>
            </div>
          </div>
        </div>

      </form>
    </div>
  );
}
