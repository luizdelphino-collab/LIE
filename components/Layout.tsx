import { Link, NavLink, Outlet } from 'react-router-dom';
import { LayoutDashboard, Briefcase, LogOut, FileText, Users } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export default function Layout() {
  const { appUser, signOut } = useAuth();

  return (
    <div className="flex-1 flex flex-col">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-9 h-9 bg-lie-green rounded-lg text-white font-logo text-sm font-bold flex items-center justify-center">
              LIE
            </div>
            <div className="leading-tight">
              <div className="font-semibold text-lie-ink text-sm">Gestão de Projetos</div>
              <div className="text-[10px] text-lie-gray uppercase tracking-wider">
                Lei de Incentivo ao Esporte
              </div>
            </div>
          </Link>

          <nav className="hidden md:flex items-center gap-1">
            <NavItem to="/" icon={<LayoutDashboard className="w-4 h-4" />} label="Dashboard" end />
            <NavItem to="/projetos" icon={<Briefcase className="w-4 h-4" />} label="Projetos" />
            <NavItem to="/relatorios" icon={<FileText className="w-4 h-4" />} label="Relatórios" />
            <NavItem to="/usuarios" icon={<Users className="w-4 h-4" />} label="Usuários" />
          </nav>

          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <div className="text-sm font-medium text-lie-ink">{appUser?.nome ?? '...'}</div>
              <div className="text-xs text-lie-gray capitalize">{appUser?.role ?? ''}</div>
            </div>
            <button
              onClick={signOut}
              title="Sair"
              className="p-2 text-lie-gray hover:text-lie-ink hover:bg-gray-100 rounded-lg transition"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
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
        `flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition ${
          isActive ? 'bg-lie-green/10 text-lie-green' : 'text-lie-gray hover:bg-gray-100'
        }`
      }
    >
      {icon}
      {label}
    </NavLink>
  );
}
