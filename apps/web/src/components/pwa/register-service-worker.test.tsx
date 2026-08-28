import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RegisterServiceWorker } from './register-service-worker';

describe('RegisterServiceWorker', () => {
  const register = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    register.mockClear();
    Object.defineProperty(window.navigator, 'serviceWorker', {
      value: {
        register,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
      configurable: true,
    });
    Object.defineProperty(document, 'readyState', {
      value: 'complete',
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing (side-effect only component)', () => {
    const { container } = render(<RegisterServiceWorker />);
    expect(container).toBeEmptyDOMElement();
  });

  it('registers /sw.js at the root scope when the document is already loaded', () => {
    render(<RegisterServiceWorker />);
    expect(register).toHaveBeenCalledWith('/sw.js');
  });

  it('does nothing (no crash) when the browser has no serviceWorker support', () => {
    Object.defineProperty(window.navigator, 'serviceWorker', {
      value: undefined,
      configurable: true,
    });
    expect(() => render(<RegisterServiceWorker />)).not.toThrow();
    expect(register).not.toHaveBeenCalled();
  });
});
