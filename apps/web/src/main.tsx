import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router';
import './i18n';
import './styles.css';
import { DialogProvider } from './components/Dialog';
import { ToastProvider } from './components/Toast';
import { ProjectListPage } from './pages/ProjectListPage';

// The editor pulls in CodeMirror and PDF.js; load it only when needed.
const EditorPage = lazy(() => import('./pages/EditorPage').then((m) => ({ default: m.EditorPage })));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <DialogProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<ProjectListPage />} />
            <Route
              path="/project/:id"
              element={
                <Suspense fallback={<div className="page loading" />}>
                  <EditorPage />
                </Suspense>
              }
            />
          </Routes>
        </BrowserRouter>
      </DialogProvider>
    </ToastProvider>
  </StrictMode>,
);
