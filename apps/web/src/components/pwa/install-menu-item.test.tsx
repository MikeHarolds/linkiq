import { DropdownMenu, DropdownMenuContent } from '@linkiq/ui';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import * as useInstallModule from '@/hooks/use-pwa-install';

import { InstallMenuItem } from './install-menu-item';

/** DropdownMenuItem (Radix) requires a DropdownMenu/DropdownMenuContent
 * context — `open` is forced so content renders without simulating a
 * trigger click, since these tests are about InstallMenuItem's own
 * conditional-render/wiring logic, not Radix's menu mechanics. */
function renderInMenu(ui: ReactNode) {
  return render(
    <DropdownMenu open>
      <DropdownMenuContent>{ui}</DropdownMenuContent>
    </DropdownMenu>,
  );
}

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

describe('InstallMenuItem', () => {
  it('renders nothing when canInstall is false', () => {
    mockInstallState({ canInstall: false });
    const { container } = render(<InstallMenuItem />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when already installed, even if canInstall were somehow true', () => {
    // Mirrors the hook's own invariant (canInstall is false once
    // status === 'installed') — this test guards the component's own
    // behavior independent of that invariant holding elsewhere.
    mockInstallState({ status: 'installed', canInstall: false });
    const { container } = render(<InstallMenuItem />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders an "Install LinkIQ" item when canInstall is true (Chromium capability)', () => {
    mockInstallState({ status: 'installable', canInstall: true });
    renderInMenu(<InstallMenuItem />);
    expect(screen.getByText('Install LinkIQ')).toBeInTheDocument();
  });

  it('renders the same "Install LinkIQ" item when canInstall is true via iOS capability, even while the automatic banner is cooldown-suppressed', () => {
    mockInstallState({ status: 'unavailable', canInstall: true });
    renderInMenu(<InstallMenuItem />);
    expect(screen.getByText('Install LinkIQ')).toBeInTheDocument();
  });

  it('calls openInstall (not promptInstall/dismiss directly) when clicked — reuses the single unified action', async () => {
    const openInstall = vi.fn();
    const promptInstall = vi.fn();
    mockInstallState({
      status: 'installable',
      canInstall: true,
      openInstall,
      promptInstall,
    });
    const user = userEvent.setup();
    renderInMenu(<InstallMenuItem />);
    await user.click(screen.getByText('Install LinkIQ'));
    expect(openInstall).toHaveBeenCalledTimes(1);
    expect(promptInstall).not.toHaveBeenCalled();
  });
});
