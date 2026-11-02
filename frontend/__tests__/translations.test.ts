import { describe, expect, it } from 'vitest';
import { translate } from '@services/translations';

describe('dashboard translations', () => {
  it('provides Arabic copy for navigation and dashboard labels', () => {
    expect(translate('ar', 'navOverview')).toBe('نظرة عامة');
    expect(translate('ar', 'historyUnavailable')).toContain('غير مفعّل');
  });

  it('interpolates values without altering source labels', () => {
    expect(translate('en', 'updatedAgo', { time: '2 minutes ago' })).toBe('Updated 2 minutes ago');
    expect(translate('ar', 'updatedAgo', { time: 'منذ دقيقتين' })).toContain('منذ دقيقتين');
  });
});
