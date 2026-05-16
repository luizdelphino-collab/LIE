import { useState, useRef } from 'react';
import { X, Upload, Image as ImageIcon } from 'lucide-react';

interface RubricaModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (rubricaUrl?: string) => void;
  title: string;
}

export default function RubricaModal({ isOpen, onClose, onConfirm, title }: RubricaModalProps) {
  const [useRubrica, setUseRubrica] = useState<boolean | null>(null);
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
    if (useRubrica && !rubricaUrl) {
      alert('Por favor, selecione uma imagem para a rubrica.');
      return;
    }
    onConfirm(useRubrica ? rubricaUrl : undefined);
    // Reset state for next use
    setUseRubrica(null);
    setRubricaUrl('');
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-zoom-in">
        <div className="bg-lie-green p-4 flex items-center justify-between text-white">
          <h3 className="font-bold flex items-center gap-2">
            <ImageIcon className="w-5 h-5" />
            Consolidar Documento
          </h3>
          <button onClick={onClose} className="hover:bg-white/20 p-1 rounded-full transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div className="text-center">
            <h4 className="text-lg font-bold text-lie-ink mb-2">{title}</h4>
            <p className="text-sm text-lie-gray">Deseja inserir rubrica em todas as páginas deste documento?</p>
          </div>

          <div className="flex gap-4">
            <button
              onClick={() => setUseRubrica(true)}
              className={`flex-1 py-3 px-4 rounded-xl border-2 transition font-bold flex flex-col items-center gap-2 ${
                useRubrica === true ? 'border-lie-green bg-lie-green/5 text-lie-green' : 'border-gray-200 text-gray-500 hover:border-gray-300'
              }`}
            >
              Sim, inserir
            </button>
            <button
              onClick={() => { setUseRubrica(false); setRubricaUrl(''); }}
              className={`flex-1 py-3 px-4 rounded-xl border-2 transition font-bold flex flex-col items-center gap-2 ${
                useRubrica === false ? 'border-lie-ink bg-lie-ink/5 text-lie-ink' : 'border-gray-200 text-gray-500 hover:border-gray-300'
              }`}
            >
              Não, gerar simples
            </button>
          </div>

          {useRubrica && (
            <div className="space-y-3 animate-fade-in">
              <label className="block text-sm font-bold text-lie-ink">Imagem da Rubrica/Carimbo:</label>
              <div 
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-gray-300 rounded-xl p-4 flex flex-col items-center justify-center cursor-pointer hover:border-lie-green transition group bg-gray-50/50"
              >
                {rubricaUrl ? (
                  <img src={rubricaUrl} alt="Rubrica" className="h-16 object-contain" />
                ) : (
                  <>
                    <Upload className="w-8 h-8 text-gray-400 group-hover:text-lie-green mb-2" />
                    <span className="text-xs text-gray-500 font-medium">Clique para selecionar imagem</span>
                    <span className="text-[10px] text-gray-400 mt-1">PNG apenas • Máx 500KB</span>
                  </>
                )}
              </div>
              <input type="file" ref={fileInputRef} className="hidden" accept="image/png" onChange={handleFileChange} />
              <p className="text-[10px] text-lie-green text-center font-semibold italic">A rubrica deve ter fundo transparente e será impressa em 1cm x 1cm.</p>
            </div>
          )}
        </div>

        <div className="p-4 bg-gray-50 flex gap-3 border-t">
          <button onClick={onClose} className="flex-1 py-2 font-bold text-gray-500 hover:bg-gray-100 rounded-lg transition">
            Cancelar
          </button>
          <button 
            onClick={handleConfirm}
            disabled={useRubrica === null}
            className="flex-1 py-2 bg-lie-green text-white font-bold rounded-lg hover:bg-lie-greenDark transition disabled:opacity-50"
          >
            Gerar PDF
          </button>
        </div>
      </div>
    </div>
  );
}
