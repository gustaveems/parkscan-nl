import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import QueuePage from './QueuePage';

const { api } = vi.hoisted(() => ({
  api: {
    getSites: vi.fn(),
    getScans: vi.fn(),
    getOutreach: vi.fn(),
    queueScanOutreach: vi.fn(),
    approveOutreachSend: vi.fn(),
    skipOutreach: vi.fn(),
    retryOutreach: vi.fn(),
    lookupOwnership: vi.fn(),
  },
}));

vi.mock('../lib/api', () => ({ api }));

describe('QueuePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getSites.mockResolvedValue({
      sites: [{
        id: 'site-1',
        address: 'Teststraat 1',
        street: 'Teststraat',
        houseNumber: '1',
        postcode: '1000AA',
        city: 'amsterdam',
        usePurpose: 'kantoorfunctie',
        areaSqm: 700,
        buildYear: 1970,
        status: 'report_ready',
        score: { vacancyScore: 88, parkingScore: 70 },
      }],
    });
    api.getScans.mockResolvedValue({
      scans: [{ id: 'scan-1', city: 'amsterdam', district: 'centrum' }],
    });
    api.getOutreach.mockResolvedValue({
      items: [{
        site: { id: 'site-1', address: 'Teststraat 1', scanId: 'scan-1' },
        score: { vacancyScore: 88 },
        owner: { ownerName: 'Owner BV' },
        outreach: {
          status: 'awaiting_approval',
          deliveryMode: 'internal_inbox',
          deliveryTo: 'internal@example.com',
          updatedAt: new Date().toISOString(),
        },
      }],
      meta: {
        policy: {
          minVacancyScore: 65,
          maxSitesPerScan: 5,
          deliveryMode: 'internal_inbox',
          deliveryTo: 'internal@example.com',
          approvalRequired: true,
        },
      },
    });
    api.approveOutreachSend.mockResolvedValue({});
    api.skipOutreach.mockResolvedValue({});
    api.retryOutreach.mockResolvedValue({});
    api.queueScanOutreach.mockResolvedValue({});
    api.lookupOwnership.mockResolvedValue({});
  });

  it('renders outreach actions for queued automation items', async () => {
    render(
      <MemoryRouter initialEntries={['/queue?scanId=scan-1']}>
        <Routes>
          <Route path="/queue" element={<QueuePage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText('Site Queue')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Outreach Queue' }));

    expect(await screen.findByText('Approve & Send')).toBeInTheDocument();
    expect(screen.getAllByText('internal@example.com').length).toBeGreaterThan(0);
  });
});
