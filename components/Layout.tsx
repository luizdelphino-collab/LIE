import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { LayoutDashboard, Briefcase, LogOut, FileText, Users, Building2, Package, Truck, ClipboardCheck, Menu, X, Key, AlertTriangle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { updatePassword } from 'firebase/auth';
import { auth } from '../lib/firebase';

export default function Layout() {
  const { appUser, signOut, primeiroAcesso, updateAppUser } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  
  // Estados para alteração de senha
  const [modalAlterarSenhaOpen, setModalAlterarSenhaOpen] = useState(false);
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmarSenha, setConfirmarSenha] = useState('');
  const [savingSenha, setSavingSenha] = useState(false);
  const [erroSenha, setErroSenha] = useState('');
  const [sucessoSenha, setSucessoSenha] = useState('');

  const handleAlterarSenha = async (e: React.FormEvent, isPrimeiroAcesso = false) => {
    e.preventDefault();
    setErroSenha('');
    setSucessoSenha('');

    if (!novaSenha.trim()) {
      setErroSenha('A nova senha é obrigatória!');
      return;
    }
    if (novaSenha !== confirmarSenha) {
      setErroSenha('As senhas não coincidem!');
      return;
    }
    if (novaSenha.length < 6) {
      setErroSenha('A senha deve ter no mínimo 6 caracteres!');
      return;
    }
    if (isPrimeiroAcesso && novaSenha === '12345678') {
      setErroSenha('Por segurança, você não pode usar a senha padrão. Escolha uma senha pessoal.');
      return;
    }

    setSavingSenha(true);
    try {
      const user = auth.currentUser;
      if (!user) {
        setErroSenha('Usuário não autenticado.');
        return;
      }
      await updatePassword(user, novaSenha.trim());
      
      // Sincronizar a nova senha no Firestore e limpar flag de primeiro acesso
      try {
        const { doc, setDoc } = await import('firebase/firestore');
        const { db } = await import('../lib/firebase');
        const userRef = doc(db, 'users', user.uid);
        const updateData: any = { senha: novaSenha.trim() };
        if (isPrimeiroAcesso) {
          updateData.primeiroAcesso = false;
        }
        await setDoc(userRef, updateData, { merge: true });
        if (isPrimeiroAcesso) {
          updateAppUser({ primeiroAcesso: false });
        }
      } catch (fsErr) {
        console.warn("Erro ao sincronizar senha nova no Firestore:", fsErr);
      }

      setSucessoSenha('Senha alterada com sucesso!');
      setNovaSenha('');
      setConfirmarSenha('');
      setTimeout(() => {
        setModalAlterarSenhaOpen(false);
        setSucessoSenha('');
      }, 1500);
    } catch (err: any) {
      console.error(err);
      if (err?.code === 'auth/requires-recent-login') {
        setErroSenha(
          'Por motivos de segurança, esta operação exige um login recente. Por favor, saia do sistema (Sair), entre novamente e tente alterar a senha.'
        );
      } else {
        setErroSenha(err?.message || 'Erro ao alterar a senha. Tente novamente.');
      }
    } finally {
      setSavingSenha(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <div className="w-9 h-9 bg-lie-green rounded-lg text-white font-logo text-sm font-bold flex items-center justify-center shrink-0">
                LIE
              </div>
              <span className="text-[9px] bg-lie-green/10 text-lie-green px-1.5 py-0.5 rounded font-mono font-semibold tracking-normal normal-case">
                v1.5.8.7
              </span>
            </div>
            <div className="leading-tight hidden xs:block">
              <div className="font-semibold text-lie-ink text-sm">
                Gestão de Projetos
              </div>
              <div className="text-[10px] text-lie-gray uppercase tracking-wider hidden sm:block">
                Lei de Incentivo ao Esporte
              </div>
            </div>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-1">
            <NavItem to="/" icon={<LayoutDashboard className="w-4 h-4" />} label="Dashboard" end />
            <NavItem to="/entidades" icon={<Building2 className="w-4 h-4" />} label="Entidades" />
            <NavItem to="/projetos" icon={<Briefcase className="w-4 h-4" />} label="Projetos" />
            <NavItem to="/itens" icon={<Package className="w-4 h-4" />} label="Itens" />
            <NavItem to="/fornecedores" icon={<Truck className="w-4 h-4" />} label="Fornecedores" />
            <NavItem to="/execucao" icon={<ClipboardCheck className="w-4 h-4" />} label="Execução" />
            <NavItem to="/relatorios" icon={<FileText className="w-4 h-4" />} label="Relatórios" />
            <NavItem to="/usuarios" icon={<Users className="w-4 h-4" />} label="Usuários" />
          </nav>

          <div className="flex items-center gap-2">
            <div className="relative">
              <button
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                className="text-right hidden sm:block hover:bg-gray-50 p-1.5 rounded-lg transition border border-transparent hover:border-gray-100"
                title="Menu do Usuário"
              >
                <div className="text-sm font-bold text-lie-ink flex items-center gap-1.5 justify-end">
                  {appUser?.nome ?? '...'}
                  <span className="text-[10px] text-lie-gray font-normal">▼</span>
                </div>
                <div className="text-xs text-lie-gray capitalize">{appUser?.role ?? ''}</div>
              </button>

              {userMenuOpen && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setUserMenuOpen(false)}></div>
                  <div className="absolute right-0 mt-2 w-48 bg-white border border-gray-100 rounded-xl shadow-lg py-1 z-30 animate-fade-in-up">
                    <button
                      onClick={() => {
                        setUserMenuOpen(false);
                        setModalAlterarSenhaOpen(true);
                      }}
                      className="w-full text-left px-4 py-2.5 text-xs font-bold text-lie-ink hover:bg-gray-50 flex items-center gap-2.5 transition"
                    >
                      <Key className="w-4 h-4 text-gray-400" />
                      Alterar Senha
                    </button>
                    <button
                      onClick={() => {
                        setUserMenuOpen(false);
                        signOut();
                      }}
                      className="w-full text-left px-4 py-2.5 text-xs font-bold text-red-600 hover:bg-red-50 flex items-center gap-2.5 transition border-t border-gray-50"
                    >
                      <LogOut className="w-4 h-4 text-red-500" />
                      Sair
                    </button>
                  </div>
                </>
              )}
            </div>
            {/* Mobile hamburger */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 text-lie-gray hover:bg-gray-100 rounded-lg transition"
              aria-label="Menu"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile dropdown menu */}
        {mobileMenuOpen && (
          <div className="md:hidden bg-white border-t border-gray-100 px-4 pb-4 pt-2 shadow-lg">
            <nav className="flex flex-col gap-1">
              <MobileNavItem to="/" icon={<LayoutDashboard className="w-5 h-5" />} label="Dashboard" end onClick={() => setMobileMenuOpen(false)} />
              <MobileNavItem to="/entidades" icon={<Building2 className="w-5 h-5" />} label="Entidades" onClick={() => setMobileMenuOpen(false)} />
              <MobileNavItem to="/projetos" icon={<Briefcase className="w-5 h-5" />} label="Projetos" onClick={() => setMobileMenuOpen(false)} />
              <MobileNavItem to="/itens" icon={<Package className="w-5 h-5" />} label="Itens" onClick={() => setMobileMenuOpen(false)} />
              <MobileNavItem to="/fornecedores" icon={<Truck className="w-5 h-5" />} label="Fornecedores" onClick={() => setMobileMenuOpen(false)} />
              <MobileNavItem to="/execucao" icon={<ClipboardCheck className="w-5 h-5" />} label="Execução" onClick={() => setMobileMenuOpen(false)} />
              <MobileNavItem to="/relatorios" icon={<FileText className="w-5 h-5" />} label="Relatórios" onClick={() => setMobileMenuOpen(false)} />
              <MobileNavItem to="/usuarios" icon={<Users className="w-5 h-5" />} label="Usuários" onClick={() => setMobileMenuOpen(false)} />
              <button
                onClick={() => {
                  setMobileMenuOpen(false);
                  setModalAlterarSenhaOpen(true);
                }}
                className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-lie-ink hover:bg-gray-100 transition mt-1"
              >
                <Key className="w-5 h-5 text-gray-400" /> Alterar Senha
              </button>
              <button
                onClick={() => { signOut(); setMobileMenuOpen(false); }}
                className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-red-500 hover:bg-red-50 transition mt-2 border-t border-gray-100 pt-3"
              >
                <LogOut className="w-5 h-5" /> Sair
              </button>
            </nav>
            <div className="mt-3 pt-3 border-t border-gray-100">
              <div className="text-sm font-medium text-lie-ink">{appUser?.nome ?? ''}</div>
              <div className="text-xs text-lie-gray capitalize">{appUser?.role ?? ''}</div>
            </div>
          </div>
        )}
      </header>

      <main className="flex-1 bg-gray-50">
        <Outlet />
      </main>

      {/* Modal - Primeiro Acesso (obrigatório, não pode ser dispensado) */}
      {primeiroAcesso && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col animate-fade-in-up">
            <header className="px-6 py-5 bg-gradient-to-r from-amber-500 to-orange-500 flex items-center gap-3">
              <AlertTriangle className="w-6 h-6 text-white shrink-0" />
              <div>
                <h3 className="font-bold text-lg text-white">Primeiro Acesso — Troca de Senha Obrigatória</h3>
                <p className="text-xs text-amber-100">Você precisa criar uma senha pessoal antes de continuar</p>
              </div>
            </header>

            <form onSubmit={(e) => handleAlterarSenha(e, true)} className="p-6 space-y-4">
              <p className="text-sm text-lie-gray leading-relaxed">
                Por segurança, altere a senha padrão <strong className="text-lie-ink font-mono">12345678</strong> antes de acessar o sistema. Escolha uma senha pessoal e guarde-a em local seguro.
              </p>

              <div>
                <label className="block text-sm font-semibold text-lie-ink mb-1">Nova Senha *</label>
                <input
                  type="password"
                  required
                  autoFocus
                  value={novaSenha}
                  onChange={(e) => setNovaSenha(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-400 focus:border-transparent font-medium text-lie-ink"
                  placeholder="Mínimo de 6 caracteres"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-lie-ink mb-1">Confirmar Nova Senha *</label>
                <input
                  type="password"
                  required
                  value={confirmarSenha}
                  onChange={(e) => setConfirmarSenha(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-400 focus:border-transparent font-medium text-lie-ink"
                  placeholder="Repita a nova senha"
                />
              </div>

              {erroSenha && (
                <div className="text-xs text-red-600 bg-red-50 border border-red-100 p-3 rounded-lg leading-relaxed">
                  {erroSenha}
                </div>
              )}

              {sucessoSenha && (
                <div className="text-xs text-green-600 bg-green-50 border border-green-100 p-3 rounded-lg font-bold">
                  {sucessoSenha}
                </div>
              )}

              <div className="flex items-center justify-between pt-2 gap-3">
                <button
                  type="button"
                  onClick={() => signOut()}
                  className="px-4 py-2 text-sm font-medium text-gray-500 hover:text-red-600 transition"
                >
                  Sair do Sistema
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-bold shadow-sm transition disabled:opacity-50"
                  disabled={savingSenha}
                >
                  {savingSenha ? 'Salvando...' : 'Definir Minha Senha'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal - Alteração de Senha */}
      {modalAlterarSenhaOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col animate-fade-in-up">
            <header className="px-6 py-4 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
              <h3 className="font-bold text-lg text-lie-ink flex items-center gap-2">
                <Key className="w-5 h-5 text-lie-green" /> Alterar Minha Senha
              </h3>
              <button
                onClick={() => {
                  setModalAlterarSenhaOpen(false);
                  setErroSenha('');
                  setSucessoSenha('');
                  setNovaSenha('');
                  setConfirmarSenha('');
                }}
                className="p-1 text-gray-400 hover:text-lie-ink rounded-lg transition"
              >
                <X className="w-5 h-5" />
              </button>
            </header>

            <form onSubmit={(e) => handleAlterarSenha(e, false)} className="p-6 space-y-4">
              <p className="text-xs text-lie-gray">
                Escolha uma nova senha forte para acessar a sua conta. A senha deve ter no mínimo 6 caracteres.
              </p>

              <div>
                <label className="block text-sm font-semibold text-lie-ink mb-1">Nova Senha</label>
                <input
                  type="password"
                  required
                  value={novaSenha}
                  onChange={(e) => setNovaSenha(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-lie-green focus:border-transparent font-medium text-lie-ink"
                  placeholder="Mínimo de 6 caracteres"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-lie-ink mb-1">Confirmar Nova Senha</label>
                <input
                  type="password"
                  required
                  value={confirmarSenha}
                  onChange={(e) => setConfirmarSenha(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-lie-green focus:border-transparent font-medium text-lie-ink"
                  placeholder="Repita a nova senha"
                />
              </div>

              {erroSenha && (
                <div className="text-xs text-red-600 bg-red-50 border border-red-100 p-3 rounded-lg leading-relaxed animate-fade-in">
                  {erroSenha}
                </div>
              )}

              {sucessoSenha && (
                <div className="text-xs text-green-600 bg-green-50 border border-green-100 p-3 rounded-lg font-bold animate-fade-in">
                  {sucessoSenha}
                </div>
              )}

              <footer className="border-t border-gray-100 pt-4 flex items-center justify-end gap-3 bg-white">
                <button
                  type="button"
                  onClick={() => {
                    setModalAlterarSenhaOpen(false);
                    setErroSenha('');
                    setSucessoSenha('');
                    setNovaSenha('');
                    setConfirmarSenha('');
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
                  disabled={savingSenha}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-lie-green hover:bg-lie-greenDark text-white rounded-lg text-sm font-bold shadow-sm transition disabled:opacity-50"
                  disabled={savingSenha}
                >
                  {savingSenha ? 'Alterando...' : 'Confirmar Alteração'}
                </button>
              </footer>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function NavItem({
  to,
  icon,
  label,
  end,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `group flex items-center p-2 rounded-lg text-sm font-medium transition-all duration-300 overflow-hidden ${
          isActive ? 'bg-lie-green/10 text-lie-green' : 'text-lie-gray hover:bg-gray-100 hover:text-lie-ink'
        }`
      }
    >
      <div className="shrink-0">{icon}</div>
      <span className="max-w-0 opacity-0 group-hover:max-w-xs group-hover:opacity-100 group-hover:ml-2 whitespace-nowrap transition-all duration-300 ease-in-out">
        {label}
      </span>
    </NavLink>
  );
}

function MobileNavItem({
  to,
  icon,
  label,
  end,
  onClick,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
  end?: boolean;
  onClick: () => void;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition ${
          isActive ? 'bg-lie-green/10 text-lie-green' : 'text-lie-gray hover:bg-gray-100 hover:text-lie-ink'
        }`
      }
    >
      {icon}
      {label}
    </NavLink>
  );
}
