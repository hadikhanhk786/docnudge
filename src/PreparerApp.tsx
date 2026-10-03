import { ClerkProvider, SignIn, SignedIn, SignedOut, UserButton } from '@clerk/clerk-react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { LangToggle } from './components/LangToggle';
import { useI18n } from './i18n';
import Dashboard from './pages/Dashboard';
import NewRequest from './pages/NewRequest';
import RequestDetail from './pages/RequestDetail';
import Settings from './pages/Settings';

function Shell() {
  const { t } = useI18n();
  return (
    <>
      <header className="app-header">
        <NavLink to="/" className="brand">
          {t('app_name')}
        </NavLink>
        <nav aria-label="Main">
          <NavLink to="/" end>{t('nav_requests')}</NavLink>
          <NavLink to="/new">{t('nav_new')}</NavLink>
          <NavLink to="/settings">{t('nav_settings')}</NavLink>
        </nav>
        <div className="header-tools">
          <LangToggle />
          <UserButton />
        </div>
      </header>
      <main className="page">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/new" element={<NewRequest />} />
          <Route path="/request/:id" element={<RequestDetail />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </>
  );
}

export default function PreparerApp() {
  const { t } = useI18n();
  const key = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;
  if (!key) {
    return (
      <main className="page">
        <h1>{t('setup_title')}</h1>
        <p className="lead">{t('setup_body')}</p>
      </main>
    );
  }
  return (
    <ClerkProvider publishableKey={key} afterSignOutUrl="/">
      <SignedOut>
        <div className="center">
          <SignIn routing="hash" />
        </div>
      </SignedOut>
      <SignedIn>
        <Shell />
      </SignedIn>
    </ClerkProvider>
  );
}
