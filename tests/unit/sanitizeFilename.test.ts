import { sanitizeFilename } from '../../src/shared/utils/sanitizeFilename';

describe('sanitizeFilename', () => {
  it.each([
    ['gorący', 'goracy'],
    ['Łódź', 'lodz'],
    ['maçã', 'maca'],
    ['niño', 'nino'],
    ['français', 'francais'],
    ['piñata divertida', 'pinata_divertida'],
    ['être sûr', 'etre_sur'],
    ['são paulo', 'sao_paulo'],
    ['bermain di bäli', 'bermain_di_bali']
  ])('transliterates %s -> %s', (input, expected) => {
    expect(sanitizeFilename(input)).toBe(expected);
  });

  it('trims and collapses whitespace', () => {
    expect(sanitizeFilename('  hola   mundo  ')).toBe('hola_mundo');
  });

  it('limits output length', () => {
    const longInput = 'á'.repeat(150);
    expect(sanitizeFilename(longInput, 10)).toHaveLength(10);
  });
});
