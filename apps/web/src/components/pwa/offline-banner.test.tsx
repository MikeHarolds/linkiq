import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { OfflineBanner } from './offline-banner';

function setOnLine(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', {
    value,
    configurable: true,
  });
}

describe('OfflineBanner', () => {
  afterEach(() => {
    setOnLine(true);
  });

  it('renders nothing while online', () => {
    setOnLine(true);
    const { container } = render(<OfflineBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the offline message immediately if already offline on mount', () => {
    setOnLine(false);
    render(<OfflineBanner />);
    expect(
      screen.getByText('You appear to be offline. Reconnect to continue.'),
    ).toBeInTheDocument();
  });

  it('appears on the offline event and clears on the online event', () => {
    setOnLine(true);
    render(<OfflineBanner />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    act(() => {
      setOnLine(false);
      window.dispatchEvent(new Event('offline'));
    });
    expect(
      screen.getByText('You appear to be offline. Reconnect to continue.'),
    ).toBeInTheDocument();

    act(() => {
      setOnLine(true);
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('never claims stale data is current — message is a reconnect instruction only', () => {
    setOnLine(false);
    render(<OfflineBanner />);
    const banner = screen.getByRole('status');
    expect(banner).toHaveAttribute('aria-live', 'polite');
    expect(banner.textContent).not.toMatch(/cached|last known|stale/i);
  });
});
