import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import QrCode from './QrCode';

const OTPAUTH = 'otpauth://totp/SignerPro:sam@example.com?secret=IZKRETMAEE3ZG2PMG2GYZFW5UFWVJUTV&issuer=SignerPro';

describe('QrCode', () => {
  it('draws a scannable matrix for an otpauth url', () => {
    const { getByRole } = render(<QrCode value={OTPAUTH} label="Scan this" />);
    const svg = getByRole('img', { name: 'Scan this' });
    const path = svg.querySelector('path');
    /* A version-7 code: enough modules that the whole URL really fits. */
    expect(svg.getAttribute('viewBox')).toBe('0 0 45 45'); // 41 modules + 2 quiet each side
    expect(path?.getAttribute('d')?.length).toBeGreaterThan(1000);
  });

  it('renders nothing rather than a broken code when the value cannot be encoded', () => {
    const { container } = render(<QrCode value="" />);
    expect(container.querySelector('svg')).toBeNull();
  });
});
