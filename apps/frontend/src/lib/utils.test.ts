import { cn } from './utils';

describe('Utility cn (classnames + tailwind-merge)', () => {
  it('merges single and multiple class strings', () => {
    expect(cn('px-2', 'py-1')).toBe('px-2 py-1');
  });

  it('filters out falsy and undefined values', () => {
    expect(cn('base-class', false && 'hidden', null, undefined, 'visible')).toBe(
      'base-class visible'
    );
  });

  it('correctly resolves conflicting Tailwind CSS classes according to cascade rules', () => {
    // tailwind-merge should resolve px-4 over px-2
    expect(cn('px-2 text-sm', 'px-4')).toBe('text-sm px-4');
    expect(cn('bg-red-500', 'bg-blue-500')).toBe('bg-blue-500');
  });

  it('handles conditional object-based classes', () => {
    expect(
      cn({
        'border-status-error': true,
        'border-subtle': false,
      })
    ).toBe('border-status-error');
  });
});
