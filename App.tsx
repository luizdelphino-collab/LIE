import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ProjetosPage from './pages/ProjetosPage';

import EntidadesPage from './pages/EntidadesPage';
import EntidadeFormPage from './pages/EntidadeFormPage';
import EntidadeDocumentosPage from './pages/EntidadeDocumentosPage';

function ProtectedRoutes() {
  const { fbUser, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-lie-gray">
        Carregando…
      </div>
    );
  }
  if (!fbUser) return <Navigate to="/login" replace />;
  return <Layout />;
}

function PublicOnly({ children }: { children: React.ReactNode }) {
  const { fbUser, loading } = useAuth();
  if (loading) return null;
  if (fbUser) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />
        <Route element={<ProtectedRoutes />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/projetos" element={<ProjetosPage />} />
          <Route path="/projetos/novo" element={<div className="p-8 text-lie-gray">Tela de novo projeto — em construção</div>} />
          <Route path="/projetos/:id" element={<div className="p-8 text-lie-gray">Detalhe do projeto — em construção</div>} />
          <Route path="/relatorios" element={<div className="p-8 text-lie-gray">Relatórios — em construção</div>} />
          <Route path="/usuarios" element={<div className="p-8 text-lie-gray">Usuários — em construção</div>} />
          
          <Route path="/entidades" element={<EntidadesPage />} />
          <Route path="/entidades/nova" element={<EntidadeFormPage />} />
          <Route path="/entidades/:id" element={<EntidadeFormPage />} />
          <Route path="/entidades/:id/documentos" element={<EntidadeDocumentosPage />} />
          
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
