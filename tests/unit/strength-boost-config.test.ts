/**
 * Unit tests for STRENGTH_BOOST_CONFIG.getPronunciationBoost
 */

import { STRENGTH_BOOST_CONFIG } from '../../src/shared/constants/index';

describe('STRENGTH_BOOST_CONFIG.getPronunciationBoost', () => {
  it('should return 0 for similarity below minimum threshold', () => {
    expect(STRENGTH_BOOST_CONFIG.getPronunciationBoost(0)).toBe(0);
    expect(STRENGTH_BOOST_CONFIG.getPronunciationBoost(0.5)).toBe(0);
    expect(STRENGTH_BOOST_CONFIG.getPronunciationBoost(0.84)).toBe(0);
    expect(STRENGTH_BOOST_CONFIG.getPronunciationBoost(0.849)).toBe(0);
  });

  it('should return 2 for good pronunciation (85-89%)', () => {
    expect(STRENGTH_BOOST_CONFIG.getPronunciationBoost(0.85)).toBe(2);
    expect(STRENGTH_BOOST_CONFIG.getPronunciationBoost(0.87)).toBe(2);
    expect(STRENGTH_BOOST_CONFIG.getPronunciationBoost(0.89)).toBe(2);
    expect(STRENGTH_BOOST_CONFIG.getPronunciationBoost(0.899)).toBe(2);
  });

  it('should return 3 for very good pronunciation (90-94%)', () => {
    expect(STRENGTH_BOOST_CONFIG.getPronunciationBoost(0.9)).toBe(3);
    expect(STRENGTH_BOOST_CONFIG.getPronunciationBoost(0.92)).toBe(3);
    expect(STRENGTH_BOOST_CONFIG.getPronunciationBoost(0.94)).toBe(3);
    expect(STRENGTH_BOOST_CONFIG.getPronunciationBoost(0.949)).toBe(3);
  });

  it('should return 4 for excellent pronunciation (95%+)', () => {
    expect(STRENGTH_BOOST_CONFIG.getPronunciationBoost(0.95)).toBe(4);
    expect(STRENGTH_BOOST_CONFIG.getPronunciationBoost(0.97)).toBe(4);
    expect(STRENGTH_BOOST_CONFIG.getPronunciationBoost(0.99)).toBe(4);
    expect(STRENGTH_BOOST_CONFIG.getPronunciationBoost(1.0)).toBe(4);
  });

  it('should handle edge cases at boundaries', () => {
    // Just below threshold
    expect(STRENGTH_BOOST_CONFIG.getPronunciationBoost(0.8499)).toBe(0);
    // At threshold
    expect(STRENGTH_BOOST_CONFIG.getPronunciationBoost(0.85)).toBe(2);
    // Just below very good
    expect(STRENGTH_BOOST_CONFIG.getPronunciationBoost(0.8999)).toBe(2);
    // At very good threshold
    expect(STRENGTH_BOOST_CONFIG.getPronunciationBoost(0.9)).toBe(3);
    // Just below excellent
    expect(STRENGTH_BOOST_CONFIG.getPronunciationBoost(0.9499)).toBe(3);
    // At excellent threshold
    expect(STRENGTH_BOOST_CONFIG.getPronunciationBoost(0.95)).toBe(4);
  });

  it('should handle negative values (edge case)', () => {
    expect(STRENGTH_BOOST_CONFIG.getPronunciationBoost(-1)).toBe(0);
    expect(STRENGTH_BOOST_CONFIG.getPronunciationBoost(-0.5)).toBe(0);
  });

  it('should handle values above 1.0 (edge case)', () => {
    expect(STRENGTH_BOOST_CONFIG.getPronunciationBoost(1.1)).toBe(4);
    expect(STRENGTH_BOOST_CONFIG.getPronunciationBoost(2.0)).toBe(4);
  });
});
