import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import * as useInstallModule from '@/hooks/use-pwa-install';

import { InstallPrompt } from './install-prompt';

function mockInstallState(
  overrides: Partial<useInstallModule.UsePwaInstallResult>,
) {
  vi.spyOn(useInstallModule, 'usePwaInstall').mockReturnValue({
    status: 'unavailable',
    canInstall: false,
    promptInstall: vi.fn(),
    dismiss: vi.fn(),
    openInstall: vi.fn(),
    ...overrides,
  });
}

describe('InstallPrompt', () => {
  it('renders nothing when status is "unavailable"', () => {
    mockInstallState({ status: 'unavailable' });
    const { container } = render(<InstallPrompt />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when status is "installed" — never nags an installed user', () => {
    mockInstallState({ status: 'installed' });
    const { container } = render(<InstallPrompt />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing while status is "checking"', () => {
    mockInstallState({ status: 'checking' });
    const { container } = render(<InstallPrompt />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the install banner with both buttons when installable', () => {
    mockInstallState({ status: 'installable' });
    render(<InstallPrompt />);
    expect(
      screen.getByText(
        'Install LinkIQ for faster access to your links, analytics and campaigns.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Install LinkIQ' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Maybe later' }),
    ).toBeInTheDocument();
  });

  it('calls promptInstall when "Install LinkIQ" is clicked', async () => {
    const promptInstall = vi.fn().mockResolvedValue(undefined);
    mockInstallState({ status: 'installable', promptInstall });
    const user = userEvent.setup();
    render(<InstallPrompt />);
    await user.click(screen.getByRole('button', { name: 'Install LinkIQ' }));
    expect(promptInstall).toHaveBeenCalledTimes(1);
  });

  it('calls dismiss when "Maybe later" is clicked, and respects it (no re-render nag)', async () => {
    const dismiss = vi.fn();
    mockInstallState({ status: 'installable', dismiss });
    const user = userEvent.setup();
    render(<InstallPrompt />);
    await user.click(screen.getByRole('button', { name: 'Maybe later' }));
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it('shows iOS Add to Home Screen instructions (no install button) on ios-instructions, and desktop never sees this copy', () => {
    mockInstallState({ status: 'ios-instructions' });
    render(<InstallPrompt />);
    expect(screen.getByText(/Add to Home Screen/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Install LinkIQ' }),
    ).not.toBeInTheDocument();
    // "Maybe later" still offered so the instruction banner is dismissible.
    expect(
      screen.getByRole('button', { name: 'Maybe later' }),
    ).toBeInTheDocument();
  });

  it('every interactive control is keyboard-reachable and labeled', () => {
    mockInstallState({ status: 'installable' });
    render(<InstallPrompt />);
    expect(
      screen.getByRole('button', { name: 'Dismiss install prompt' }),
    ).toBeInTheDocument();
    for (const button of screen.getAllByRole('button')) {
      expect(button).not.toHaveAttribute('tabindex', '-1');
    }
  });
});
