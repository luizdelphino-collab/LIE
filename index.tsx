import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';

// Redirecionamento automático para o domínio oficial de produção
const correctDomain = 'projetos.lie.com.br';
if (window.location.hostname === 'lie-projetos.web.app' || window.location.hostname === 'lie-projetos.firebaseapp.com') {
  window.location.replace(`https://${correctDomain}${window.location.pathname}${window.location.search}${window.location.hash}`);
}

// Redirecionamento amigável caso acesse a rota de validação pública sem o caractere hash '#'
if (window.location.pathname === '/validar' || window.location.pathname.startsWith('/validar')) {
  window.location.replace('/#/validar' + window.location.search);
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find root element to mount to');
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>
);
