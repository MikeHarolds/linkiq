import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

import '@testing-library/jest-dom/vitest';

// vitest.config.ts doesn't set test.globals, so React Testing Library's
// own auto-cleanup (which relies on detecting a global `afterEach`)
// never registers on its own — without this, DOM nodes from one test's
// render() leak into the next test in the same file, causing spurious
// "found multiple elements" failures.
afterEach(() => {
  cleanup();
});
