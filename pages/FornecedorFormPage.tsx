import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, getDoc, setDoc, serverTimestamp, collection } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Save, ArrowLeft, Image as ImageIcon, Plus, Trash2, MapPin, Globe, Instagram, Facebook, Share2, Info, Loader2, FileText } from 'lucide-react';
import { db, storage } from '../lib/firebase';
import { fetchCep } from '../lib/cep';
import type { Fornecedor } from '../types';

export default function FornecedorFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id;

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [secundarias, setSecundarias] = useState<string[]>([]);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  const [formData, setFormData] = useState<Partial<Fornecedor>>({
    razaoSocial: '',
    nomeFantasia: '',
    cnpj: '',
    atuacaoPrimaria: '',
    cep: '',
    logradouro: '',
    numero: '',
    complemento: '',
    bairro: '',
    cidade: '',
    uf: '',
    telefoneComercial: '',
    celular: '',
    email: '',
    site: '',
    instagram: '',
    facebook: '',
    outraRede: '',
    observacoes: ''
  });

  useEffect(() => {
    if (!isNew) {
      (async () => {
        try {
          const snap = await getDoc(doc(db, 'suppliers', id));
          if (snap.exists()) {
            const data = snap.data() as Fornecedor;
            setFormData(data);
            setSecundarias(data.atuacoesSecundarias || []);
            if (data.logoUrl) setLogoPreview(data.logoUrl);
          }
        } finally {
          setLoading(false);
        }
      })();
    }
  }, [id, isNew]);

  const formatCNPJ = (v: string) => v.replace(/\D/g, '').replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2').substring(0, 18);
  const formatCEP = (v: string) => v.replace(/\D/g, '').replace(/^(\d{5})(\d)/, '$1-$2').substring(0, 9);
  const formatPhone = (v: string) => {
    const d = v.replace(/\D/g, '');
    if (d.length <= 10) return d.replace(/^(\d{2})(\d)/g, '($1) $2').replace(/(\d{4})(\d)/, '$1-$2').substring(0, 14);
    return d.replace(/^(\d{2})(\d)/g, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2').substring(0, 15);
  };

  const handleCEP = async (rawValue: string) => {
    const cep = formatCEP(rawValue);
    setFormData(p => ({ ...p, cep }));
    if (cep.replace(/\D/g, '').length === 8) {
      const info = await fetchCep(cep);
      if (info) {
        setFormData(p => ({
          ...p,
          logradouro: info.logradouro,
          bairro: info.bairro,
          cidade: info.localidade,
          uf: info.uf
        }));
      }
    }
  };

  const addSecundaria = () => setSecundarias([...secundarias, '']);
  const updateSecundaria = (idx: number, val: string) => {
    const copy = [...secundarias];
    copy[idx] = val;
    setSecundarias(copy);
  };
  const removeSecundaria = (idx: number) => setSecundarias(secundarias.filter((_, i) => i !== idx));

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.size > 1024 * 1024) {
        alert("A imagem deve ter no máximo 1MB");
        return;
      }
      setLogoFile(file);
      setLogoPreview(URL.createObjectURL(file));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const finalId = id || doc(collection(db, 'suppliers')).id;
      let logoUrl = formData.logoUrl;

      if (logoFile) {
        const logoRef = ref(storage, `suppliers/${finalId}/logo_${Date.now()}`);
        const snap = await uploadBytes(logoRef, logoFile);
        logoUrl = await getDownloadURL(snap.ref);
      }

      const payload: any = {
        ...formData,
        id: finalId,
        atuacoesSecundarias: secundarias.filter(s => s.trim() !== ''),
        atualizadoEm: serverTimestamp()
      };
      if (logoUrl) payload.logoUrl = logoUrl;

      if (isNew) payload.criadoEm = serverTimestamp();

      await setDoc(doc(db, 'suppliers', finalId), payload, { merge: true });
      navigate('/fornecedores');
    } catch (e) {
      console.error(e);
      alert("Erro ao salvar fornecedor");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-8 text-lie-gray">Carregando...</div>;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <header className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/fornecedores')} className="p-2 text-lie-gray hover:bg-gray-100 rounded-lg transition">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-2xl font-bold text-lie-ink">{isNew ? 'Novo Fornecedor' : 'Editar Fornecedor'}</h1>
        </div>
        {!isNew && (
          <button 
            onClick={() => navigate(`/fornecedores/${id}/documentos`)}
            className="inline-flex items-center gap-2 bg-white border border-gray-300 text-blue-600 px-4 py-2 rounded-lg hover:bg-blue-50 transition font-medium"
          >
            <FileText className="w-4 h-4" /> Documentos
          </button>
        )}
      </header>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Seção 1: Identificação */}
        <section className="bg-white rounded-xl shadow-premium p-6 border border-gray-100">
          <h2 className="text-lg font-bold text-lie-ink mb-4 flex items-center gap-2">
            <Info className="w-5 h-5 text-lie-green" /> Identificação e Atuação
          </h2>
          
          <div className="flex flex-col md:flex-row gap-6 mb-6">
            <div className="flex-shrink-0">
              <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Logo do Fornecedor</label>
              <div 
                className="w-32 h-32 border-2 border-dashed border-gray-200 rounded-xl flex flex-col items-center justify-center bg-gray-50 overflow-hidden group relative cursor-pointer hover:border-lie-green transition"
                onClick={() => document.getElementById('logo-input')?.click()}
              >
                {logoPreview ? (
                  <img src={logoPreview} alt="Logo" className="w-full h-full object-contain p-2" />
                ) : (
                  <>
                    <ImageIcon className="w-8 h-8 text-gray-300 group-hover:text-lie-green transition" />
                    <span className="text-[10px] text-gray-400 mt-1">PNG/JPG (Max 1MB)</span>
                  </>
                )}
                <input id="logo-input" type="file" className="hidden" accept="image/*" onChange={handleLogoChange} />
              </div>
            </div>

            <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm font-bold text-gray-700 mb-1">Razão Social *</label>
                <input type="text" required value={formData.razaoSocial} onChange={e => setFormData(p => ({...p, razaoSocial: e.target.value}))} className="w-full border-gray-300 rounded-lg shadow-sm" />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Nome Fantasia *</label>
                <input type="text" required value={formData.nomeFantasia} onChange={e => setFormData(p => ({...p, nomeFantasia: e.target.value}))} className="w-full border-gray-300 rounded-lg shadow-sm" />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">CNPJ *</label>
                <input type="text" required placeholder="00.000.000/0000-00" value={formData.cnpj} onChange={e => setFormData(p => ({...p, cnpj: formatCNPJ(e.target.value)}))} className="w-full border-gray-300 rounded-lg shadow-sm" />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-bold text-gray-700 mb-1">Atuação Primária *</label>
                <input type="text" required placeholder="Ex: Material Esportivo, RH, Obras..." value={formData.atuacaoPrimaria} onChange={e => setFormData(p => ({...p, atuacaoPrimaria: e.target.value}))} className="w-full border-gray-300 rounded-lg shadow-sm" />
              </div>
            </div>
          </div>

          <div className="space-y-3 pt-4 border-t border-gray-50">
            <label className="block text-sm font-bold text-gray-700">Atuações Secundárias</label>
            {secundarias.map((s, idx) => (
              <div key={idx} className="flex gap-2">
                <input type="text" value={s} onChange={e => updateSecundaria(idx, e.target.value)} className="flex-1 border-gray-300 rounded-lg text-sm" placeholder="Ex: Consultoria, Eventos..." />
                <button type="button" onClick={() => removeSecundaria(idx)} className="p-2 text-red-500 hover:bg-red-50 rounded-lg"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
            <button type="button" onClick={addSecundaria} className="inline-flex items-center gap-2 text-sm text-lie-green hover:underline font-medium">
              <Plus className="w-4 h-4" /> Adicionar atuação secundária
            </button>
          </div>
        </section>

        {/* Seção 2: Endereço */}
        <section className="bg-white rounded-xl shadow-premium p-6 border border-gray-100">
          <h2 className="text-lg font-bold text-lie-ink mb-4 flex items-center gap-2">
            <MapPin className="w-5 h-5 text-lie-green" /> Endereço
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">CEP</label>
              <input type="text" value={formData.cep} onChange={e => handleCEP(e.target.value)} className="w-full border-gray-300 rounded-lg shadow-sm" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-bold text-gray-700 mb-1">Logradouro</label>
              <input type="text" value={formData.logradouro} onChange={e => setFormData(p => ({...p, logradouro: e.target.value}))} className="w-full border-gray-300 rounded-lg shadow-sm" />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Número</label>
              <input type="text" value={formData.numero} onChange={e => setFormData(p => ({...p, numero: e.target.value}))} className="w-full border-gray-300 rounded-lg shadow-sm" />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Complemento</label>
              <input type="text" value={formData.complemento} onChange={e => setFormData(p => ({...p, complemento: e.target.value}))} className="w-full border-gray-300 rounded-lg shadow-sm" />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Bairro</label>
              <input type="text" value={formData.bairro} onChange={e => setFormData(p => ({...p, bairro: e.target.value}))} className="w-full border-gray-300 rounded-lg shadow-sm" />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Cidade</label>
              <input type="text" value={formData.cidade} onChange={e => setFormData(p => ({...p, cidade: e.target.value}))} className="w-full border-gray-300 rounded-lg shadow-sm" />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">UF</label>
              <input type="text" maxLength={2} value={formData.uf} onChange={e => setFormData(p => ({...p, uf: e.target.value.toUpperCase()}))} className="w-full border-gray-300 rounded-lg shadow-sm" />
            </div>
          </div>
        </section>

        {/* Seção 3: Contato e Redes */}
        <section className="bg-white rounded-xl shadow-premium p-6 border border-gray-100">
          <h2 className="text-lg font-bold text-lie-ink mb-4 flex items-center gap-2">
            <Globe className="w-5 h-5 text-lie-green" /> Contato e Redes Sociais
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">E-mail</label>
              <input type="email" value={formData.email} onChange={e => setFormData(p => ({...p, email: e.target.value}))} className="w-full border-gray-300 rounded-lg shadow-sm" />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Telefone Comercial</label>
              <input type="text" placeholder="(00) 0000-0000" value={formData.telefoneComercial} onChange={e => setFormData(p => ({...p, telefoneComercial: formatPhone(e.target.value)}))} className="w-full border-gray-300 rounded-lg shadow-sm" />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Celular / WhatsApp</label>
              <input type="text" placeholder="(00) 00000-0000" value={formData.celular} onChange={e => setFormData(p => ({...p, celular: formatPhone(e.target.value)}))} className="w-full border-gray-300 rounded-lg shadow-sm" />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1 flex items-center gap-1.5"><Globe className="w-3.5 h-3.5" /> Site</label>
              <input type="text" value={formData.site} onChange={e => setFormData(p => ({...p, site: e.target.value}))} className="w-full border-gray-300 rounded-lg shadow-sm" />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1 flex items-center gap-1.5"><Instagram className="w-3.5 h-3.5" /> Instagram</label>
              <input type="text" placeholder="@usuario" value={formData.instagram} onChange={e => setFormData(p => ({...p, instagram: e.target.value}))} className="w-full border-gray-300 rounded-lg shadow-sm" />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1 flex items-center gap-1.5"><Facebook className="w-3.5 h-3.5" /> Facebook</label>
              <input type="text" value={formData.facebook} onChange={e => setFormData(p => ({...p, facebook: e.target.value}))} className="w-full border-gray-300 rounded-lg shadow-sm" />
            </div>
            <div className="md:col-span-3">
              <label className="block text-sm font-bold text-gray-700 mb-1 flex items-center gap-1.5"><Share2 className="w-3.5 h-3.5" /> Outra Rede Social</label>
              <input type="text" placeholder="LinkedIn, TikTok, etc..." value={formData.outraRede} onChange={e => setFormData(p => ({...p, outraRede: e.target.value}))} className="w-full border-gray-300 rounded-lg shadow-sm" />
            </div>
          </div>
        </section>

        <section className="bg-white rounded-xl shadow-premium p-6 border border-gray-100">
          <label className="block text-sm font-bold text-gray-700 mb-1">Observações Gerais</label>
          <textarea rows={4} value={formData.observacoes} onChange={e => setFormData(p => ({...p, observacoes: e.target.value}))} className="w-full border-gray-300 rounded-lg shadow-sm"></textarea>
        </section>

        <div className="flex justify-end gap-3 pt-6">
          <button type="button" onClick={() => navigate('/fornecedores')} className="px-6 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium transition">Cancelar</button>
          <button type="submit" disabled={saving} className="bg-lie-green hover:bg-lie-greenDark text-white px-12 py-2 rounded-lg font-bold shadow-lg transition flex items-center gap-2">
            {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
            {saving ? 'Salvando...' : 'Salvar Fornecedor'}
          </button>
        </div>
      </form>
    </div>
  );
}
