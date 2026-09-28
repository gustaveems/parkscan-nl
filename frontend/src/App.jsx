import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import ScanPage from './pages/ScanPage';
import QueuePage from './pages/QueuePage';
import StatsPage from './pages/StatsPage';
import SitePage from './pages/SitePage';
import ReportPage from './pages/ReportPage';

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<ScanPage />} />
        <Route path="/queue" element={<QueuePage />} />
        <Route path="/stats" element={<StatsPage />} />
        <Route path="/sites/:id" element={<SitePage />} />
        <Route path="/sites/:id/report" element={<ReportPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
