import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { LayoutDashboard, Briefcase, LogOut, FileText, Users, Building2, Package, Truck, ClipboardCheck, Menu, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export default function Layout() {
  const { appUser, signOut } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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
                v1.3.0
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
            <div className="text-right hidden sm:block">
              <div className="text-sm font-medium text-lie-ink">{appUser?.nome ?? '...'}</div>
              <div className="text-xs text-lie-gray capitalize">{appUser?.role ?? ''}</div>
            </div>
            <button
              onClick={signOut}
              title="Sair"
              className="p-2 text-lie-gray hover:text-lie-ink hover:bg-gray-100 rounded-lg transition hidden sm:flex"
            >
              <LogOut className="w-4 h-4" />
            </button>
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
