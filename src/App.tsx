import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { I18nProvider } from './i18n';
import ClientUpload from './pages/ClientUpload';
import PreparerApp from './PreparerApp';

// Clients open /r/:token and never load Clerk. Only the firm side pulls in the sign-in code.
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/r/:token"
          element={
            <I18nProvider persist={false}>
              <ClientUpload />
            </I18nProvider>
          }
        />
        <Route
          path="/*"
          element={
            <I18nProvider>
              <PreparerApp />
            </I18nProvider>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
