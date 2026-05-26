import { useState, useRef } from 'react';
import { X, Upload, Printer, FileText, FileBadge, CheckSquare, Square } from 'lucide-react';
import type { PrintOptions } from '../lib/consolidarProjeto';

interface PrintOptionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (options: PrintOptions) => void;
  title: string;
}

export default function PrintOptionsModal({ isOpen, onClose, onConfirm, title }: PrintOptionsModalProps) {
  const [projeto, setProjeto] = useState(true);
  const [pesquisa, setPesquisa] = useState(true);
  const [documentosEntidade, setDocumentosEntidade] = useState(false);
  const [certidoes, setCertidoes] = useState(false);
  
  const [numerarRubricar, setNumerarRubricar] = useState(false);
  const [rubricaUrl, setRubricaUrl] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.includes('png')) {
      alert('A rubrica deve ser uma imagem PNG com fundo transparente.');
      return;
    }
    if (file.size > 500 * 1024) {
      alert('A rubrica deve ter no máximo 500KB.');
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      setRubricaUrl(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleConfirm = () => {
    if (!projeto && !pesquisa && !documentosEntidade && !certidoes) {
      alert('Selecione pelo menos uma opção para imprimir.');
      return;
    }
    if (numerarRubricar && !rubricaUrl) {
      alert('Por favor, selecione uma imagem para a rubrica.');
      return;
    }
    
    onConfirm({
      projeto,
      pesquisa,
      documentosEntidade,
      certidoes,
      numerarRubricar,
      rubricaUrl: numerarRubricar ? rubricaUrl : undefined
    });

    // Reset state for next use
    setProjeto(true);
    setPesquisa(true);
    setDocumentosEntidade(false);
    setCertidoes(false);
    setNumerarRubricar(false);
    setRubricaUrl('');
  };

  const OptionRow = ({ icon: Icon, label, desc, checked, onChange }: any) => (
    <div 
      className={`flex items-start gap-3 p-3 rounded-xl border-2 transition cursor-pointer ${checked ? 'border-lie-green bg-lie-green/5' : 'border-gray-200 hover:border-lie-green/50'}`}
      onClick={() => onChange(!checked)}
    >
      <div className="mt-0.5">
        {checked ? <CheckSquare className="w-5 h-5 text-lie-green" /> : <Square className="w-5 h-5 text-gray-400" />}
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2 font-bold text-lie-ink">
          <Icon className={`w-4 h-4 ${checked ? 'text-lie-green' : 'text-gray-500'}`} />
          {label}
        </div>
        <div className="text-xs text-gray-500 mt-0.5">{desc}</div>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh] animate-zoom-in">
        <div className="bg-lie-green p-4 flex items-center justify-between text-white shrink-0">
          <h3 className="font-bold flex items-center gap-2">
            <Printer className="w-5 h-5" />
            Opções de Impressão
          </h3>
          <button onClick={onClose} className="hover:bg-white/20 p-1 rounded-full transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-4">
          <div className="text-center">
            <h4 className="text-lg font-bold text-lie-ink mb-1">{title}</h4>
            <p className="text-sm text-lie-gray">Selecione quais seções deseja incluir no PDF final.</p>
          </div>

          <div className="space-y-3">
            <OptionRow 
              icon={FileText} 
              label="Plano de Trabalho Completo" 
              desc="Cronogramas, Metas, Resumo Financeiro e Dados Gerais" 
              checked={projeto} 
              onChange={setProjeto} 
            />
            <OptionRow 
              icon={FileBadge} 
              label="Pesquisa de Preços (IN 65/2021)" 
              desc="Laudos estatísticos e juntada das cotações públicas/manuais" 
              checked={pesquisa} 
              onChange={setPesquisa} 
            />
            <OptionRow 
              icon={FileText} 
              label="Documentos da Entidade" 
              desc="Estatuto, Atas, CNPJ e demais anexos institucionais" 
              checked={documentosEntidade} 
              onChange={setDocumentosEntidade} 
            />
            <OptionRow 
              icon={FileBadge} 
              label="Certidões da Entidade" 
              desc="Certidões ativas anexadas ao perfil da entidade" 
              checked={certidoes} 
              onChange={setCertidoes} 
            />
          </div>

          <div className="pt-4 border-t space-y-4">
            <OptionRow 
              icon={CheckSquare} 
              label="Numerar e Rubricar Todas as Páginas" 
              desc="Aplica numeração sequencial e carimbo/rubrica no rodapé" 
              checked={numerarRubricar} 
              onChange={setNumerarRubricar} 
            />

            {numerarRubricar && (
              <div className="space-y-3 animate-fade-in pl-11">
                <label className="block text-sm font-bold text-lie-ink">Imagem da Rubrica/Carimbo:</label>
                <div 
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-gray-300 rounded-xl p-4 flex flex-col items-center justify-center cursor-pointer hover:border-lie-green transition group bg-gray-50/50"
                >
                  {rubricaUrl ? (
                    <img src={rubricaUrl} alt="Rubrica" className="h-16 object-contain" />
                  ) : (
                    <>
                      <Upload className="w-6 h-6 text-gray-400 group-hover:text-lie-green mb-2" />
                      <span className="text-xs text-gray-500 font-medium">Clique para selecionar imagem</span>
                    </>
                  )}
                </div>
                <input type="file" ref={fileInputRef} className="hidden" accept="image/png" onChange={handleFileChange} />
                <p className="text-[10px] text-lie-green font-semibold italic">Fundo transparente, max 500KB.</p>
              </div>
            )}
          </div>
        </div>

        <div className="p-4 bg-gray-50 flex gap-3 border-t shrink-0">
          <button onClick={onClose} className="flex-1 py-2 font-bold text-gray-500 hover:bg-gray-100 rounded-lg transition">
            Cancelar
          </button>
          <button 
            onClick={handleConfirm}
            className="flex-1 py-2 bg-lie-green text-white font-bold rounded-lg hover:bg-lie-greenDark transition"
          >
            Gerar PDF
          </button>
        </div>
      </div>
    </div>
  );
}
