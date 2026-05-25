import { useEffect, useState } from 'react';
import { collection, getDocs, query, orderBy, deleteDoc, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { Plus, Search, Trash2, Edit2, Shield, Mail, CheckCircle2, XCircle, Building, Phone, UserCheck, X, Key } from 'lucide-react';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import { db } from '../lib/firebase';
import type { AppUser, UserRole, Projeto } from '../types';

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrador',
  coordenador: 'Coordenador',
  captador: 'Captador',
  financeiro: 'Financeiro',
  beneficiado: 'Beneficiado',
  leitor: 'Leitor',
};

const ROLE_COLORS: Record<UserRole, string> = {
  admin: 'bg-red-50 text-red-700 border border-red-100',
  coordenador: 'bg-indigo-50 text-indigo-700 border border-indigo-100',
  captador: 'bg-amber-50 text-amber-700 border border-amber-100',
  financeiro: 'bg-emerald-50 text-emerald-700 border border-emerald-100',
  beneficiado: 'bg-purple-50 text-purple-700 border border-purple-100',
  leitor: 'bg-gray-50 text-gray-700 border border-gray-100',
};

export default function UsuariosPage() {
  const [usuarios, setUsuarios] = useState<AppUser[]>([]);
  const [projetos, setProjetos] = useState<Projeto[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [selectedUser, setSelectedUser] = useState<AppUser | null>(null);

  // Form Fields
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [cpf, setCpf] = useState('');
  const [telefone, setTelefone] = useState('');
  const [role, setRole] = useState<UserRole>('leitor');
  const [ativo, setAtivo] = useState(true);
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [senha, setSenha] = useState('');
  const [confirmarSenha, setConfirmarSenha] = useState('');
  const [resettingPassword, setResettingPassword] = useState(false);

  const carregarDados = async () => {
    try {
      setLoading(true);
      // Carregar usuários
      const uSnap = await getDocs(query(collection(db, 'users'), orderBy('nome', 'asc')));
      setUsuarios(uSnap.docs.map(d => ({ uid: d.id, ...d.data() } as AppUser)));

      // Carregar projetos para seleção
      const pSnap = await getDocs(query(collection(db, 'projects'), orderBy('titulo', 'asc')));
      setProjetos(pSnap.docs.map(d => ({ id: d.id, ...d.data() } as Projeto)));
    } catch (e) {
      console.error('Erro ao carregar dados dos usuários:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregarDados();
  }, []);

  const openCreateModal = () => {
    setModalMode('create');
    setSelectedUser(null);
    setNome('');
    setEmail('');
    setCpf('');
    setTelefone('');
    setRole('leitor');
    setAtivo(true);
    setSelectedProjectIds([]);
    setSenha('');
    setConfirmarSenha('');
    setIsModalOpen(true);
  };

  const SENHA_PADRAO = '12345678';

  const openEditModal = (user: AppUser) => {
    setModalMode('edit');
    setSelectedUser(user);
    setNome(user.nome || '');
    setEmail(user.email || '');
    setCpf(user.cpf || '');
    setTelefone(user.telefone || '');
    setRole(user.role || 'leitor');
    setAtivo(user.ativo !== false);
    setSelectedProjectIds(user.projectIds || []);
    setSenha('');
    setConfirmarSenha('');
    setIsModalOpen(true);
  };

  const handleSendResetPassword = async () => {
    if (!email) return;
    setResettingPassword(true);
    try {
      const { auth } = await import('../lib/firebase');
      await sendPasswordResetEmail(auth, email.trim().toLowerCase());
      alert(`Um e-mail de redefinição de senha foi enviado para ${email} com sucesso!`);
    } catch (err: any) {
      console.error(err);
      alert("Erro ao enviar e-mail de redefinição: " + (err?.message || err));
    } finally {
      setResettingPassword(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome.trim() || !email.trim()) {
      alert('Nome e E-mail são obrigatórios!');
      return;
    }

    const isNew = modalMode === 'create';

    // Novos usuários sempre usam senha padrão - sem validação de senha no formulário
    if (!isNew && senha.trim()) {
      if (senha.trim().length < 6) {
        alert('A senha deve ter no mínimo 6 caracteres!');
        return;
      }
    }

    try {
      setLoading(true);
      let uid = '';
      
      const payload: any = {
        nome: nome.trim(),
        email: email.trim().toLowerCase(),
        cpf: cpf.trim(),
        telefone: telefone.trim(),
        role,
        ativo,
        projectIds: role === 'admin' ? [] : selectedProjectIds,
        atualizadoEm: serverTimestamp(),
      };

      if (isNew) {
        // Criar conta no Firebase Authentication usando o App secundário com senha padrão
        const firebaseConfig = {
          apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
          authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
          projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
          storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
          messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
          appId: import.meta.env.VITE_FIREBASE_APP_ID,
        };

        const secondaryApp = initializeApp(firebaseConfig, `Secondary_${Date.now()}`);
        const secondaryAuth = getAuth(secondaryApp);
        
        try {
          const userCredential = await createUserWithEmailAndPassword(
            secondaryAuth,
            email.trim().toLowerCase(),
            SENHA_PADRAO  // Sempre usa senha padrão
          );
          uid = userCredential.user.uid;
        } catch (authErr: any) {
          console.error("Erro ao criar credencial de autenticação:", authErr);
          let userMsg = "Erro ao criar credencial de autenticação. ";
          if (authErr?.code === 'auth/email-already-in-use') {
            userMsg += "Este e-mail já está cadastrado no sistema.";
          } else if (authErr?.code === 'auth/invalid-email') {
            userMsg += "O e-mail informado é inválido.";
          } else if (authErr?.code === 'auth/operation-not-allowed') {
            userMsg += "Cadastro com e-mail/senha não está habilitado no Firebase. Verifique as configurações.";
          } else {
            userMsg += authErr?.message || authErr;
          }
          alert(userMsg);
          return;
        } finally {
          await deleteApp(secondaryApp);
        }

        payload.uid = uid;
        payload.criadoEm = serverTimestamp();
        payload.senha = SENHA_PADRAO;  // Guardar senha padrão no Firestore
        payload.primeiroAcesso = true;  // Flag para forçar troca de senha no primeiro login
      } else {
        uid = selectedUser!.uid;
        
        if (senha.trim()) {
          const firebaseConfig = {
            apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
            authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
            projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
            storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
            messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
            appId: import.meta.env.VITE_FIREBASE_APP_ID,
          };

          const secondaryApp = initializeApp(firebaseConfig, `SecondaryUpdate_${Date.now()}`);
          const secondaryAuth = getAuth(secondaryApp);
          const { signInWithEmailAndPassword, updatePassword } = await import('firebase/auth');
          
          try {
            const senhaAntiga = (selectedUser as any)?.senha || '';
            if (!senhaAntiga) {
              throw new Error(
                "Não foi encontrada a senha registrada para este usuário. " +
                "Utilize 'Enviar E-mail de Redefinição' para que o usuário redefina via link."
              );
            }
            
            const userCredential = await signInWithEmailAndPassword(
              secondaryAuth,
              email.trim().toLowerCase(),
              senhaAntiga.trim()
            );
            
            await updatePassword(userCredential.user, senha.trim());
            payload.senha = senha.trim();
            // Resetar flag de primeiro acesso se admin trocar a senha
            payload.primeiroAcesso = false;
          } catch (authErr: any) {
            console.error("Erro ao atualizar senha no Authentication:", authErr);
            const code = authErr?.code;
            let msg = "Não foi possível redefinir a senha manualmente. ";
            if (code === 'auth/invalid-credential' || code === 'auth/wrong-password') {
              msg += "A senha registrada no sistema está desatualizada. Peça ao usuário para fazer login primeiro, ou use 'Enviar E-mail de Redefinição'.";
            } else {
              msg += authErr?.message || authErr;
            }
            alert(msg);
            return;
          } finally {
            await deleteApp(secondaryApp);
          }
        }
      }

      const userRef = doc(db, 'users', uid);
      await setDoc(userRef, payload, { merge: true });
      setIsModalOpen(false);
      await carregarDados();
    } catch (err) {
      console.error('Erro ao salvar usuário:', err);
      alert('Erro ao salvar usuário: ' + (err instanceof Error ? err.message : 'Erro desconhecido'));
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (uid: string, nomeUsuario: string) => {
    if (!confirm(`Tem certeza que deseja excluir o usuário "${nomeUsuario}"?`)) return;
    try {
      await deleteDoc(doc(db, 'users', uid));
      setUsuarios(prev => prev.filter(u => u.uid !== uid));
    } catch (err) {
      console.error('Erro ao excluir usuário:', err);
      alert('Erro ao excluir usuário');
    }
  };

  const toggleProjectSelection = (projId: string) => {
    setSelectedProjectIds(prev =>
      prev.includes(projId) ? prev.filter(id => id !== projId) : [...prev, projId]
    );
  };

  const filtered = usuarios.filter(u =>
    (u.nome || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (u.email || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (u.cpf || '').includes(searchTerm)
  );

  return (
    <div className="p-6 max-w-7xl mx-auto pb-32">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-lie-ink">Usuários</h1>
          <p className="text-sm text-lie-gray">Gerencie o acesso dos membros do sistema e atribuição de projetos</p>
        </div>
        <button
          onClick={openCreateModal}
          className="group flex items-center bg-lie-green text-white rounded-lg p-2.5 transition-all duration-300 hover:bg-lie-greenDark shadow-sm font-medium text-sm"
        >
          <Plus className="w-5 h-5 shrink-0" />
          <span className="max-w-0 opacity-0 group-hover:max-w-xs group-hover:opacity-100 group-hover:ml-2 whitespace-nowrap transition-all duration-300 ease-in-out font-medium">
            Novo Usuário
          </span>
        </button>
      </header>

      <div className="mb-6 relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <Search className="h-5 w-5 text-gray-400" />
        </div>
        <input
          type="text"
          className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-xl bg-white placeholder-gray-500 focus:outline-none focus:ring-lie-green focus:border-lie-green sm:text-sm font-medium text-lie-ink"
          placeholder="Buscar por nome, e-mail ou CPF..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="text-lie-gray italic p-8 text-center">Carregando usuários do sistema...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl shadow-premium p-12 text-center border border-gray-100">
          <UserCheck className="w-12 h-12 text-gray-200 mx-auto mb-4" />
          <p className="text-lie-gray">Nenhum usuário cadastrado.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-premium overflow-hidden border border-gray-100">
          <table className="w-full text-left">
            <thead className="bg-gray-50 text-xs font-bold text-lie-gray uppercase border-b border-gray-200">
              <tr>
                <th className="px-4 py-3">Membro</th>
                <th className="px-4 py-3">Contato</th>
                <th className="px-4 py-3 text-center">Função</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(u => (
                <tr key={u.uid} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3.5">
                    <div className="font-bold text-lie-ink">{u.nome}</div>
                    <div className="text-xs text-gray-400 font-mono">{u.cpf ? `CPF: ${u.cpf}` : 'CPF não informado'}</div>
                  </td>
                  <td className="px-4 py-3.5 text-sm">
                    <div className="flex items-center gap-1.5 text-gray-600">
                      <Mail className="w-3.5 h-3.5 text-gray-400" />
                      {u.email}
                    </div>
                    {u.telefone && (
                      <div className="flex items-center gap-1.5 text-gray-500 text-xs mt-0.5">
                        <Phone className="w-3 h-3 text-gray-400" />
                        {u.telefone}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-center">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${ROLE_COLORS[u.role || 'leitor']}`}>
                      <Shield className="w-3 h-3 mr-1" />
                      {ROLE_LABELS[u.role || 'leitor']}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-center">
                    {u.ativo !== false ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-green-50 text-green-700 border border-green-100">
                        <CheckCircle2 className="w-3 h-3 mr-1" />
                        Ativo
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-red-50 text-red-700 border border-red-100">
                        <XCircle className="w-3 h-3 mr-1" />
                        Inativo
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => openEditModal(u)}
                        className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition"
                        title="Editar Perfil"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(u.uid, u.nome)}
                        className="p-1.5 text-red-500 hover:bg-red-50 rounded transition"
                        title="Excluir Usuário"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal - Cadastro e Edição */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-fade-in-up">
            <header className="px-6 py-4 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
              <h3 className="font-bold text-lg text-lie-ink">
                {modalMode === 'create' ? 'Cadastrar Novo Usuário' : 'Editar Perfil do Usuário'}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1 text-gray-400 hover:text-lie-ink rounded-lg transition"
              >
                <X className="w-5 h-5" />
              </button>
            </header>

            <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-lie-ink mb-1">Nome Completo *</label>
                  <input
                    type="text"
                    required
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-lie-green focus:border-transparent font-medium text-lie-ink"
                    placeholder="Nome do usuário"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-lie-ink mb-1">E-mail *</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-lie-green focus:border-transparent font-medium text-lie-ink"
                    placeholder="exemplo@email.com"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-lie-ink mb-1">CPF</label>
                  <input
                    type="text"
                    value={cpf}
                    onChange={(e) => setCpf(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-lie-green focus:border-transparent font-medium text-lie-ink"
                    placeholder="000.000.000-00"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-lie-ink mb-1">Telefone / WhatsApp</label>
                  <input
                    type="text"
                    value={telefone}
                    onChange={(e) => setTelefone(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-lie-green focus:border-transparent font-medium text-lie-ink"
                    placeholder="(00) 00000-0000"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-lie-ink mb-1">Função / Perfil no Sistema *</label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as UserRole)}
                    className="w-full px-4 py-2 border border-gray-300 bg-white rounded-lg focus:ring-2 focus:ring-lie-green focus:border-transparent font-semibold text-lie-ink"
                  >
                    {Object.entries(ROLE_LABELS).map(([k, label]) => (
                      <option key={k} value={k}>{label}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center pt-6">
                  <label className="inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={ativo}
                      onChange={(e) => setAtivo(e.target.checked)}
                      className="rounded border-gray-300 text-lie-green focus:ring-lie-green w-4 h-4"
                    />
                    <span className="ml-2 text-sm font-semibold text-lie-ink">Usuário Ativo e com Acesso</span>
                  </label>
                </div>
              </div>

              {/* Seção de Senha ou Redefinição */}
              {modalMode === 'create' ? (
                <div className="border-t border-gray-100 pt-4">
                  <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-xl p-4">
                    <div className="text-blue-500 mt-0.5">
                      <Key className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-blue-800">Senha padrão automática</p>
                      <p className="text-xs text-blue-600 mt-0.5">
                        O usuário será criado com a senha <strong>12345678</strong>. No primeiro acesso, o sistema exigirá que ele crie uma senha pessoal.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="border-t border-gray-100 pt-4 space-y-4">
                  <label className="block text-sm font-bold text-lie-ink">
                    Alteração de Senha
                  </label>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-gray-50 border border-gray-200 rounded-xl p-4">
                    <div className="space-y-3">
                      <h4 className="text-xs font-bold text-lie-ink">Definir Senha Manualmente</h4>
                      <div>
                        <label className="block text-[11px] font-semibold text-lie-gray mb-1">Nova Senha</label>
                        <input
                          type="password"
                          value={senha}
                          onChange={(e) => setSenha(e.target.value)}
                          className="w-full px-3 py-1.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-lie-green focus:border-transparent font-medium text-xs text-lie-ink"
                          placeholder="Nova senha (mín. 6)"
                        />
                      </div>
                      <p className="text-[10px] text-lie-gray leading-normal">
                        Deixe em branco se não desejar alterar a senha deste usuário manualmente neste momento.
                      </p>
                    </div>
                    
                    <div className="border-t md:border-t-0 md:border-l border-gray-200 pt-3 md:pt-0 md:pl-4 flex flex-col justify-between">
                      <div>
                        <h4 className="text-xs font-bold text-lie-ink mb-1">Enviar Redefinição por E-mail</h4>
                        <p className="text-[10px] text-lie-gray leading-normal">
                          Dispare um link de redefinição oficial em português para a caixa de e-mail deste usuário cadastrar uma nova senha.
                        </p>
                      </div>
                      <div className="pt-3">
                        <button
                          type="button"
                          disabled={resettingPassword}
                          onClick={handleSendResetPassword}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-amber-300 text-amber-700 hover:bg-amber-50 rounded-lg text-xs font-bold transition shadow-sm w-full justify-center"
                        >
                          <Key className="w-3.5 h-3.5" />
                          {resettingPassword ? 'Enviando...' : 'Enviar E-mail de Redefinição'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Atribuição de Projetos (se não for admin) */}
              {role !== 'admin' && (
                <div className="border-t border-gray-100 pt-4">
                  <label className="block text-sm font-bold text-lie-ink mb-2">
                    Projetos Vinculados (Acesso)
                  </label>
                  <p className="text-xs text-lie-gray mb-3">
                    Selecione os projetos aos quais este usuário terá acesso para executar ou monitorar.
                  </p>
                  {projetos.length === 0 ? (
                    <div className="text-sm text-lie-gray italic">Nenhum projeto cadastrado no sistema.</div>
                  ) : (
                    <div className="border border-gray-200 rounded-lg p-3 max-h-48 overflow-y-auto space-y-2 bg-gray-50">
                      {projetos.map(p => (
                        <label key={p.id} className="flex items-start gap-2.5 p-1.5 hover:bg-white rounded cursor-pointer transition">
                          <input
                            type="checkbox"
                            checked={selectedProjectIds.includes(p.id)}
                            onChange={() => toggleProjectSelection(p.id)}
                            className="rounded border-gray-300 text-lie-green focus:ring-lie-green w-4 h-4 mt-0.5"
                          />
                          <div className="text-xs font-semibold text-lie-ink">
                            <div>{p.titulo || p.nome || 'Projeto Sem Título'}</div>
                            <span className="text-[10px] text-lie-gray font-normal">
                              {p.entidadeSigla ? `Entidade: ${p.entidadeSigla}` : 'Sem entidade vinculada'}
                            </span>
                          </div>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <footer className="border-t border-gray-100 pt-4 flex items-center justify-end gap-3 bg-white">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-lie-green hover:bg-lie-greenDark text-white rounded-lg text-sm font-bold shadow-sm transition"
                >
                  Salvar
                </button>
              </footer>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
