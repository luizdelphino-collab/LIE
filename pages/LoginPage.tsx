import { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { useNavigate } from 'react-router-dom';
import { auth } from '../lib/firebase';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro('');
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, senha);
      navigate('/');
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'auth/invalid-credential' || code === 'auth/wrong-password') {
        setErro('E-mail ou senha inválidos.');
      } else if (code === 'auth/user-not-found') {
        setErro('Usuário não encontrado.');
      } else {
        setErro('Erro ao entrar. Tente novamente.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center bg-gradient-to-br from-lie-green to-lie-greenDark px-4 py-12">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-premium p-8 animate-fade-in-up">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-lie-green rounded-xl text-white font-logo text-2xl font-bold mb-3">
            LIE
          </div>
          <h1 className="text-2xl font-bold text-lie-ink">Gestão de Projetos</h1>
          <p className="text-sm text-lie-gray mt-1">Lei de Incentivo ao Esporte</p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-lie-ink mb-1">E-mail</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-lie-green focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-lie-ink mb-1">Senha</label>
            <input
              type="password"
              required
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              autoComplete="current-password"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-lie-green focus:border-transparent"
            />
          </div>

          {erro && (
            <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{erro}</div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-lie-green hover:bg-lie-greenDark text-white font-semibold py-2.5 rounded-lg transition disabled:opacity-50"
          >
            {loading ? 'Entrando…' : 'Entrar'}
          </button>
        </form>

        <p className="text-xs text-lie-gray text-center mt-6">
          Acesso restrito. Solicite credenciais ao administrador.
        </p>
      </div>
    </div>
  );
}
