/**
 * The signer-side mirror of `field_service.validate_value`.
 *
 * The bug this closes: an Email field accepted "dfghgdfhfdh", counted towards
 * the progress bar, and the signer learned nothing was wrong until the value
 * was posted.
 */
import { describe, it, expect } from 'vitest';
import { effectiveValidation, fieldValueProblem } from './fieldValidation';

describe('fieldValueProblem', () => {
  it('rejects a non-address in an email field even with validation off', () => {
    expect(fieldValueProblem({ type: 'email', validation: 'none' }, 'dfghgdfhfdh')).toMatch(/email address/i);
    expect(fieldValueProblem({ type: 'email', validation: 'email' }, 'nope@')).toMatch(/email address/i);
  });

  it('accepts a real address', () => {
    expect(fieldValueProblem({ type: 'email', validation: 'email' }, 'buyer@example.com')).toBeNull();
    expect(fieldValueProblem({ type: 'email', validation: 'none' }, ' buyer@example.co.uk ')).toBeNull();
  });

  it('leaves an empty value to `required`', () => {
    expect(fieldValueProblem({ type: 'email', validation: 'email' }, '')).toBeNull();
    expect(fieldValueProblem({ type: 'email', validation: 'email' }, undefined)).toBeNull();
  });

  it('enforces numbers on a number field and allows separators', () => {
    expect(fieldValueProblem({ type: 'number', validation: 'none' }, 'twelve')).toMatch(/number/i);
    expect(fieldValueProblem({ type: 'number', validation: 'none' }, '1,200.50')).toBeNull();
  });

  it('checks a date only when the sender asked for it', () => {
    expect(fieldValueProblem({ type: 'date', validation: 'none' }, 'next Tuesday')).toBeNull();
    expect(fieldValueProblem({ type: 'date', validation: 'date' }, 'next Tuesday')).toMatch(/date/i);
    expect(fieldValueProblem({ type: 'date', validation: 'date' }, '08/20/2026')).toBeNull();
    expect(fieldValueProblem({ type: 'date', validation: 'date' }, '2026-08-20')).toBeNull();
  });

  it('never second-guesses a signature or a custom pattern', () => {
    expect(fieldValueProblem({ type: 'signature', validation: 'email' }, 'typed:Caveat:Sam')).toBeNull();
    // The pattern lives on the API row, so `custom` is the server's call.
    expect(fieldValueProblem({ type: 'text', validation: 'custom' }, 'anything')).toBeNull();
  });

  it('reports which kind is actually enforced', () => {
    expect(effectiveValidation({ type: 'email', validation: 'none' })).toBe('email');
    expect(effectiveValidation({ type: 'text', validation: 'none' })).toBe('none');
    expect(effectiveValidation({ type: 'text', validation: 'numeric' })).toBe('numeric');
  });
});
