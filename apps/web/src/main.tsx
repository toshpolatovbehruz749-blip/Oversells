import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router';
import './i18n';
import './styles.css';
import { DialogProvider } from './components/Dialog';
import { ToastProvider } from './components/Toast';
import { ProjectListPage } from './pages/ProjectListPage';
import { AuthProvider, RequireAuth } from './auth/AuthContext';
import { ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage } from './pages/AuthPages';
import { TemplateGalleryPage } from './pages/TemplateGalleryPage';

// The editor pulls in CodeMirror and PDF.js; load it only when needed.
const EditorPage = lazy(() => import('./pages/EditorPage').then((m) => ({ default: m.EditorPage })));
const SharedProjectPage = lazy(() =>
  import('./pages/SharedProjectPage').then((m) => ({ default: m.SharedProjectPage })),
);

const loading = <div className="page loading" />;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <DialogProvider>
        <BrowserRouter>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route
                path="/"
                element={
                  <RequireAuth>
                    <ProjectListPage />
                  </RequireAuth>
                }
              />
              <Route
                path="/new"
                element={
                  <RequireAuth>
                    <TemplateGalleryPage />
                  </RequireAuth>
                }
              />
              <Route
                path="/project/:id"
                element={
                  <RequireAuth>
                    <Suspense fallback={loading}>
                      <EditorPage />
                    </Suspense>
                  </RequireAuth>
                }
              />
              <Route
                path="/s/:token"
                element={
                  <Suspense fallback={loading}>
                    <SharedProjectPage />
                  </Suspense>
                }
              />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </DialogProvider>
    </ToastProvider>
  </StrictMode>,
);
