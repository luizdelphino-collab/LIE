import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ProjetosPage from './pages/ProjetosPage';
import ProjetoOverviewPage from './pages/ProjetoOverviewPage';
import ProjetoFormPage from './pages/ProjetoFormPage';
import ProjetoDocumentosPage from './pages/ProjetoDocumentosPage';
import ProjetoCronogramaPage from './pages/ProjetoCronogramaPage';
import ItensMasterPage from './pages/ItensMasterPage';
import ProjetoItensPage from './pages/ProjetoItensPage';
import ProjetoOrcamentoPage from './pages/ProjetoOrcamentoPage';
import ProjetoExecucaoPage from './pages/ProjetoExecucaoPage';
import ProjetoPrestacaoPage from './pages/ProjetoPrestacaoPage';
import FornecedoresPage from './pages/FornecedoresPage';
import FornecedorFormPage from './pages/FornecedorFormPage';
import FornecedorDocumentosPage from './pages/FornecedorDocumentosPage';
import ExecucaoProjetosPage from './pages/ExecucaoProjetosPage';
import ExecucaoFornecedoresPage from './pages/ExecucaoFornecedoresPage';
import ExecucaoMensalPage from './pages/ExecucaoMensalPage';

import EntidadesPage from './pages/EntidadesPage';
import EntidadeFormPage from './pages/EntidadeFormPage';
import EntidadeDocumentosPage from './pages/EntidadeDocumentosPage';
import CapacidadeTecnicaPage from './pages/CapacidadeTecnicaPage';
import DirigentesPage from './pages/DirigentesPage';
import DirigenteFormPage from './pages/DirigenteFormPage';
import UsuariosPage from './pages/UsuariosPage';
import ValidarCotacaoPage from './pages/ValidarCotacaoPage';

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
        <Route path="/validar" element={<ValidarCotacaoPage />} />
        <Route element={<ProtectedRoutes />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/projetos" element={<ProjetosPage />} />
          <Route path="/projetos/novo" element={<ProjetoFormPage />} />
          <Route path="/projetos/:id" element={<ProjetoOverviewPage />} />
          <Route path="/projetos/:id/plano" element={<ProjetoFormPage />} />
          <Route path="/projetos/:id/documentos" element={<ProjetoDocumentosPage />} />
          <Route path="/projetos/:id/itens" element={<ProjetoOrcamentoPage />} />
          <Route path="/projetos/:id/cronograma" element={<ProjetoOrcamentoPage />} />
          {/* tela legada de itens (mantida p/ referência): /projetos/:id/itens-antigo */}
          <Route path="/projetos/:id/itens-antigo" element={<ProjetoItensPage />} />
          <Route path="/projetos/:id/execucao" element={<ProjetoExecucaoPage />} />
          <Route path="/projetos/:id/prestacao" element={<ProjetoPrestacaoPage />} />
          <Route path="/itens" element={<ItensMasterPage />} />
          <Route path="/fornecedores" element={<FornecedoresPage />} />
          <Route path="/fornecedores/novo" element={<FornecedorFormPage />} />
          <Route path="/fornecedores/:id" element={<FornecedorFormPage />} />
          <Route path="/fornecedores/:id/documentos" element={<FornecedorDocumentosPage />} />
          
          {/* Execução */}
          <Route path="/execucao" element={<ExecucaoProjetosPage />} />
          <Route path="/execucao/:id/fornecedores" element={<ExecucaoFornecedoresPage />} />
          <Route path="/execucao/:id/mensal" element={<ExecucaoMensalPage />} />

          <Route path="/relatorios" element={<div className="p-8 text-lie-gray">Relatórios — em construção</div>} />
          <Route path="/usuarios" element={<UsuariosPage />} />
          
          <Route path="/entidades" element={<EntidadesPage />} />
          <Route path="/entidades/nova" element={<EntidadeFormPage />} />
          <Route path="/entidades/:id" element={<EntidadeFormPage />} />
          <Route path="/entidades/:id/documentos" element={<EntidadeDocumentosPage />} />
          <Route path="/entidades/:id/capacidade-tecnica" element={<CapacidadeTecnicaPage />} />
          <Route path="/entidades/:id/dirigentes" element={<DirigentesPage />} />
          <Route path="/entidades/:id/dirigentes/novo" element={<DirigenteFormPage />} />
          <Route path="/entidades/:id/dirigentes/:dirId" element={<DirigenteFormPage />} />
          
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
