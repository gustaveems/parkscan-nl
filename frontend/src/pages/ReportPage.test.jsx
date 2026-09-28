import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ReportPage from './ReportPage';

const { api } = vi.hoisted(() => ({
  api: {
    getSite: vi.fn(),
    getReport: vi.fn(),
    getOwnerPortfolio: vi.fn(),
    updateOutreach: vi.fn(),
    approveOutreachSend: vi.fn(),
    retryOutreach: vi.fn(),
    skipOutreach: vi.fn(),
  },
}));

vi.mock('../lib/api', () => ({ api }));

describe('ReportPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getSite.mockResolvedValue({
      site: { id: 'site-1', lat: 52.37, lng: 4.89, frontage: null },
      outreach: {
        status: 'awaiting_approval',
        draft: 'Hello world',
        subject: 'Subject',
      },
    });
    api.getReport.mockResolvedValue({
      report: {
        generatedAt: new Date().toISOString(),
        site: {
          id: 'site-1',
          address: 'Teststraat 1',
          bagId: 'bag-1',
          city: 'amsterdam',
          district: 'centrum',
          scanId: 'scan-1',
          status: 'report_ready',
          lat: 52.37,
          lng: 4.89,
          street: 'Teststraat',
          houseNumber: '1',
          postcode: '1000AA',
          usePurpose: 'kantoorfunctie',
          areaSqm: 700,
          buildYear: 1970,
          parcelRef: 'parcel-1',
          bagStatus: 'Pand buiten gebruik',
        },
        score: {
          vacancyScore: 88,
          parkingScore: 70,
          confidence: 'high',
          reasons: [],
          modelVersion: '1.0.0',
          scoredAt: new Date().toISOString(),
        },
        owner: {
          ownerName: 'Owner BV',
          retrievedAt: new Date().toISOString(),
          ownershipType: 'Eigendom',
          ownershipConfidence: 'high',
          parcelRef: 'parcel-1',
          restrictions: [],
        },
        conversion: {
          spacesEst: 10,
          revenueLow: 1000,
          revenueBase: 1200,
          revenueHigh: 1400,
          setupCostLow: 20000,
          setupCostHigh: 25000,
        },
        outreach: {
          status: 'awaiting_approval',
          draft: 'Hello world',
          subject: 'Subject',
          deliveryTo: 'internal@example.com',
          provider: 'mock',
        },
      },
    });
    api.getOwnerPortfolio.mockResolvedValue({ ownerName: 'Owner BV', sites: [] });
    api.updateOutreach.mockResolvedValue({});
    api.approveOutreachSend.mockResolvedValue({});
    api.retryOutreach.mockResolvedValue({});
    api.skipOutreach.mockResolvedValue({});
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText: vi.fn() },
      configurable: true,
    });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ available: false }),
    });
  });

  it('saves content and approves send from the report surface', async () => {
    render(
      <MemoryRouter initialEntries={['/sites/site-1/report']}>
        <Routes>
          <Route path="/sites/:id/report" element={<ReportPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByDisplayValue('Subject')).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue('Subject'), { target: { value: 'Updated Subject' } });
    fireEvent.click(screen.getByRole('button', { name: /approve & send to test inbox/i }));

    await waitFor(() => {
      expect(api.updateOutreach).toHaveBeenCalledWith('site-1', {
        draft: 'Hello world',
        subject: 'Updated Subject',
      });
      expect(api.approveOutreachSend).toHaveBeenCalledWith('site-1');
    });
  });
});
