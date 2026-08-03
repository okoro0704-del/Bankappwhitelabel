import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { TransferPage } from '../pages/user/TransferPage';
import { ToastProvider } from '../components/ui/Toast';
import { visualProgressPercent, isVerificationStatus } from '../transfer/visualProgress';
import { clearActiveTransferId, rememberActiveTransferId } from '../transfer/session';
import { ApiError } from '../api/errors';

vi.mock('../api/endpoints', () => ({
  api: {
    getWallet: vi.fn(),
    getAccount: vi.fn(),
    createTransfer: vi.fn(),
    getTransfer: vi.fn(),
    getVerification: vi.fn(),
    submitVerification: vi.fn(),
    getTransfers: vi.fn(),
  },
}));

import { api } from '../api/endpoints';

const wallet = {
  id: 'w1',
  accountId: 'a1',
  balance: 500,
  currency: 'USD',
  updatedAt: new Date().toISOString(),
};

const account = {
  id: 'a1',
  accountNumber: '1234567890',
  accountType: 'four_stage_verification' as const,
  accountStatus: 'active' as const,
  balance: 500,
  currency: 'USD',
  oneTimeTransferUsed: false,
};

function baseTransfer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tr-1',
    reference: 'XFER-1',
    status: 'verification_stage_1',
    amount: 25,
    recipient: { name: 'Alex Riv', account: '9988776655', bank: 'Harbor Bank' },
    description: 'Rent',
    currentStage: 1,
    stagesCompleted: 0,
    reasonCode: null,
    failureReason: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    ...overrides,
  };
}

function renderTransfer(path = '/app/transfer') {
  const router = createMemoryRouter(
    [
      { path: '/app/transfer', element: <TransferPage /> },
      { path: '/app', element: <div>Dashboard home</div> },
      { path: '/app/transactions', element: <div>Transactions home</div> },
    ],
    { initialEntries: [path] },
  );

  return render(
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>,
  );
}

async function fillAndConfirm(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByLabelText(/recipient name/i);
  await user.type(screen.getByLabelText(/recipient name/i), 'Alex Riv');
  await user.type(screen.getByLabelText(/recipient account number/i), '9988776655');
  await user.type(screen.getByLabelText(/recipient bank/i), 'Harbor Bank');
  await user.type(screen.getByLabelText(/^amount$/i), '25');
  await user.click(screen.getByRole('button', { name: /continue to review/i }));
  await user.type(screen.getByLabelText(/transfer pin/i), '7890');
  await user.click(screen.getByRole('button', { name: /confirm transfer/i }));
}

describe('visual progress helpers', () => {
  it('maps stages to visual percentages only', () => {
    expect(visualProgressPercent({ status: 'verification_required', stage: 1 })).toBe(25);
    expect(visualProgressPercent({ status: 'verification_required', stage: 2 })).toBe(50);
    expect(visualProgressPercent({ status: 'verification_required', stage: 3 })).toBe(75);
    expect(visualProgressPercent({ status: 'verification_required', stage: 4 })).toBe(90);
    expect(visualProgressPercent({ status: 'completed' })).toBe(100);
    expect(isVerificationStatus('verification_stage_3')).toBe(true);
  });
});

describe('transfer workflow', () => {
  beforeEach(() => {
    clearActiveTransferId();
    vi.mocked(api.getWallet).mockResolvedValue(wallet);
    vi.mocked(api.getAccount).mockResolvedValue(account);
    vi.mocked(api.createTransfer).mockReset();
    vi.mocked(api.getTransfer).mockReset();
    vi.mocked(api.getVerification).mockReset();
    vi.mocked(api.submitVerification).mockReset();
    vi.mocked(api.getTransfers).mockReset();
  });

  afterEach(() => {
    clearActiveTransferId();
  });

  it('shows escrow restricted state from backend response', async () => {
    const user = userEvent.setup();
    vi.mocked(api.createTransfer).mockResolvedValue({
      status: 'restricted',
      reasonCode: 'EXTERNAL_TRANSFER_NOT_ALLOWED',
      reference: 'XFER-ESC',
      amount: 25,
      transferId: 'tr-esc',
      transfer: baseTransfer({
        id: 'tr-esc',
        reference: 'XFER-ESC',
        status: 'restricted',
        reasonCode: 'EXTERNAL_TRANSFER_NOT_ALLOWED',
      }),
    });

    renderTransfer();
    await fillAndConfirm(user);

    expect(await screen.findByText(/external transfer unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText('EXTERNAL_TRANSFER_NOT_ALLOWED')).not.toBeInTheDocument();
    expect(screen.getByText(/no funds were moved/i)).toBeInTheDocument();
  });

  it('shows completed state for successful one-time transfer', async () => {
    const user = userEvent.setup();
    vi.mocked(api.createTransfer).mockResolvedValue({
      status: 'completed',
      transferId: 'tr-ok',
      transactionId: 'tx-1',
      reference: 'XFER-OK',
      amount: 25,
      transfer: baseTransfer({
        id: 'tr-ok',
        reference: 'XFER-OK',
        status: 'completed',
        completedAt: new Date().toISOString(),
      }),
    });
    vi.mocked(api.getWallet).mockResolvedValue({ ...wallet, balance: 475 });

    renderTransfer();
    await fillAndConfirm(user);

    expect(await screen.findByText(/transfer completed/i)).toBeInTheDocument();
    expect(screen.getByText(/XFER-OK/)).toBeInTheDocument();
  });

  it('shows failed state for transfer limit reached', async () => {
    const user = userEvent.setup();
    vi.mocked(api.createTransfer).mockRejectedValue(
      new ApiError('TRANSFER_LIMIT_REACHED', 'limit', 400),
    );

    renderTransfer();
    await fillAndConfirm(user);

    expect(await screen.findByText(/transfer failed/i)).toBeInTheDocument();
    expect(
      screen.getByText(/could not be completed\. please contact the bank/i),
    ).toBeInTheDocument();
  });

  it('advances four-stage verification from backend stage responses', async () => {
    const user = userEvent.setup();
    vi.mocked(api.createTransfer).mockResolvedValue({
      status: 'verification_required',
      stage: 1,
      transferId: 'tr-1',
      reference: 'XFER-1',
      amount: 25,
      transfer: baseTransfer(),
    });
    vi.mocked(api.getVerification)
      .mockResolvedValueOnce({
        transferId: 'tr-1',
        status: 'verification_stage_1',
        stage: 1,
        stagesCompleted: 0,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      })
      .mockResolvedValueOnce({
        transferId: 'tr-1',
        status: 'verification_stage_2',
        stage: 2,
        stagesCompleted: 1,
      })
      .mockResolvedValueOnce({
        transferId: 'tr-1',
        status: 'verification_stage_3',
        stage: 3,
        stagesCompleted: 2,
      })
      .mockResolvedValueOnce({
        transferId: 'tr-1',
        status: 'verification_stage_4',
        stage: 4,
        stagesCompleted: 3,
      });

    vi.mocked(api.submitVerification)
      .mockResolvedValueOnce({
        status: 'verification_required',
        stage: 2,
        transferId: 'tr-1',
        transfer: baseTransfer({ status: 'verification_stage_2', currentStage: 2, stagesCompleted: 1 }),
      })
      .mockResolvedValueOnce({
        status: 'verification_required',
        stage: 3,
        transferId: 'tr-1',
        transfer: baseTransfer({ status: 'verification_stage_3', currentStage: 3, stagesCompleted: 2 }),
      })
      .mockResolvedValueOnce({
        status: 'verification_required',
        stage: 4,
        transferId: 'tr-1',
        transfer: baseTransfer({ status: 'verification_stage_4', currentStage: 4, stagesCompleted: 3 }),
      })
      .mockResolvedValueOnce({
        status: 'completed',
        transferId: 'tr-1',
        transactionId: 'tx-9',
        reference: 'XFER-1',
        amount: 25,
        transfer: baseTransfer({
          status: 'completed',
          currentStage: 4,
          stagesCompleted: 4,
          completedAt: new Date().toISOString(),
        }),
      });

    vi.mocked(api.getTransfer).mockImplementation(async () => baseTransfer());

    renderTransfer();
    await fillAndConfirm(user);

    expect(await screen.findByText(/additional verification required/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/verification stage 1 of 4/i)).toBeInTheDocument();

    async function enterCode(code: string) {
      const boxes = screen.getAllByLabelText(/digit \d of 6/i);
      for (let i = 0; i < code.length; i += 1) {
        await user.clear(boxes[i]);
        await user.type(boxes[i], code[i]);
      }
      await user.click(screen.getByRole('button', { name: /^continue$/i }));
    }

    await enterCode('111111');
    expect(await screen.findByLabelText(/verification stage 2 of 4/i)).toBeInTheDocument();

    await enterCode('222222');
    expect(await screen.findByLabelText(/verification stage 3 of 4/i)).toBeInTheDocument();

    await enterCode('333333');
    expect(await screen.findByLabelText(/verification stage 4 of 4/i)).toBeInTheDocument();

    await enterCode('444444');
    expect(await screen.findByText(/transfer completed/i)).toBeInTheDocument();
  });

  it('maps verification and balance errors to friendly UI', async () => {
    const user = userEvent.setup();
    vi.mocked(api.createTransfer).mockResolvedValue({
      status: 'verification_required',
      stage: 1,
      transferId: 'tr-1',
      transfer: baseTransfer(),
    });
    vi.mocked(api.getVerification).mockResolvedValue({
      transferId: 'tr-1',
      status: 'verification_stage_1',
      stage: 1,
      stagesCompleted: 0,
    });
    vi.mocked(api.getTransfer).mockResolvedValue(baseTransfer());
    vi.mocked(api.submitVerification).mockRejectedValue(
      new ApiError('INVALID_VERIFICATION_CODE', 'bad', 400),
    );

    renderTransfer();
    await fillAndConfirm(user);
    expect(await screen.findByText(/additional verification required/i)).toBeInTheDocument();

    const boxes = screen.getAllByLabelText(/digit \d of 6/i);
    for (let i = 0; i < 6; i += 1) await user.type(boxes[i], String(i + 1));
    await user.click(screen.getByRole('button', { name: /^continue$/i }));
    expect(await screen.findByText(/incorrect verification code/i)).toBeInTheDocument();
  });

  it('shows expired and too-many-attempts verification errors', async () => {
    const user = userEvent.setup();
    vi.mocked(api.createTransfer).mockResolvedValue({
      status: 'verification_required',
      stage: 1,
      transferId: 'tr-1',
      transfer: baseTransfer(),
    });
    vi.mocked(api.getVerification).mockResolvedValue({
      transferId: 'tr-1',
      status: 'verification_stage_1',
      stage: 1,
      stagesCompleted: 0,
    });
    vi.mocked(api.getTransfer).mockResolvedValue(baseTransfer());

    renderTransfer();
    await fillAndConfirm(user);
    await screen.findByText(/additional verification required/i);

    vi.mocked(api.submitVerification).mockRejectedValueOnce(
      new ApiError('VERIFICATION_EXPIRED', 'expired', 400),
    );
    const boxes = screen.getAllByLabelText(/digit \d of 6/i);
    for (let i = 0; i < 6; i += 1) await user.type(boxes[i], '1');
    await user.click(screen.getByRole('button', { name: /^continue$/i }));
    expect(await screen.findByText(/verification code expired/i)).toBeInTheDocument();

    vi.mocked(api.submitVerification).mockRejectedValueOnce(
      new ApiError('TOO_MANY_VERIFICATION_ATTEMPTS', 'stop', 400),
    );
    for (let i = 0; i < 6; i += 1) {
      await user.clear(boxes[i]);
      await user.type(boxes[i], '2');
    }
    await user.click(screen.getByRole('button', { name: /^continue$/i }));
    expect(await screen.findByText(/too many incorrect attempts/i)).toBeInTheDocument();
  });

  it('surfaces insufficient balance and inactive account on review', async () => {
    const user = userEvent.setup();
    vi.mocked(api.createTransfer).mockRejectedValue(
      new ApiError('INSUFFICIENT_BALANCE', 'nope', 400),
    );

    renderTransfer();
    await fillAndConfirm(user);
    expect(await screen.findByText(/not enough balance/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /confirm transfer/i })).toBeInTheDocument();

    vi.mocked(api.createTransfer).mockRejectedValue(
      new ApiError('ACCOUNT_INACTIVE', 'inactive', 403),
    );
    await user.click(screen.getByRole('button', { name: /confirm transfer/i }));
    expect(await screen.findByText(/account is inactive/i)).toBeInTheDocument();
  });

  it('recovers verification stage from backend after reload', async () => {
    rememberActiveTransferId('tr-1');
    vi.mocked(api.getTransfer).mockResolvedValue(
      baseTransfer({ status: 'verification_stage_2', currentStage: 2, stagesCompleted: 1 }),
    );
    vi.mocked(api.getVerification).mockResolvedValue({
      transferId: 'tr-1',
      status: 'verification_stage_2',
      stage: 2,
      stagesCompleted: 1,
    });

    renderTransfer('/app/transfer?transferId=tr-1');

    expect(await screen.findByText(/additional verification required/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/verification stage 2 of 4/i)).toBeInTheDocument();
    expect(api.getTransfer).toHaveBeenCalledWith('tr-1');
    expect(api.getVerification).toHaveBeenCalledWith('tr-1');
  });

  it('recovers completed transfer from backend id', async () => {
    vi.mocked(api.getTransfer).mockResolvedValue(
      baseTransfer({
        status: 'completed',
        completedAt: new Date().toISOString(),
        reference: 'XFER-DONE',
      }),
    );

    renderTransfer('/app/transfer?transferId=tr-1');
    expect(await screen.findByText(/transfer completed/i)).toBeInTheDocument();
    expect(screen.getByText(/XFER-DONE/)).toBeInTheDocument();
  });

  it('handles duplicate request by resuming existing transfer', async () => {
    const user = userEvent.setup();
    clearActiveTransferId();
    vi.mocked(api.createTransfer).mockRejectedValue(
      new ApiError('DUPLICATE_REQUEST', 'dup', 409),
    );
    vi.mocked(api.getTransfers).mockResolvedValue({
      items: [
        baseTransfer({
          id: 'tr-dup',
          status: 'completed',
          reference: 'XFER-DUP',
          completedAt: new Date().toISOString(),
        }),
      ],
      limit: 1,
      offset: 0,
      total: 1,
    });
    vi.mocked(api.getTransfer).mockResolvedValue(
      baseTransfer({
        id: 'tr-dup',
        status: 'completed',
        reference: 'XFER-DUP',
        completedAt: new Date().toISOString(),
      }),
    );

    renderTransfer();
    await fillAndConfirm(user);

    await waitFor(() => {
      expect(api.getTransfer).toHaveBeenCalledWith('tr-dup');
    });
    expect(await screen.findByText(/transfer completed/i)).toBeInTheDocument();
  });
});
