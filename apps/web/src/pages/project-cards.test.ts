import { describe, expect, it } from 'vitest';
import { projectColour, projectInitial, relativeTime } from './project-cards';

describe('project cards', () => {
  it('takes the first letter and a steady colour', () => {
    expect(projectInitial('Oʻqituvchilar uchun qoʻllanma')).toBe('O');
    expect(projectInitial('«2-sinf» kitob')).toBe('2');
    expect(projectInitial('—')).toBe('•');
    expect(projectColour('Olimpiada-1')).toBe(projectColour('Olimpiada-1'));
    expect(projectColour('Olimpiada-1')).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('says how long ago, and the date when it is old', () => {
    const now = new Date('2026-11-03T12:00:00Z');
    const fallback = new Intl.DateTimeFormat('en', { dateStyle: 'short', timeZone: 'UTC' });
    const t = (key: string, o?: { count: number }) => `${key}${o ? `:${o.count}` : ''}`;
    expect(relativeTime(new Date('2026-11-03T11:59:40Z'), now, t, fallback)).toBe('projects.ago.now');
    expect(relativeTime(new Date('2026-11-03T11:55:00Z'), now, t, fallback)).toBe('projects.ago.minutes:5');
    expect(relativeTime(new Date('2026-11-03T09:00:00Z'), now, t, fallback)).toBe('projects.ago.hours:3');
    expect(relativeTime(new Date('2026-11-02T11:00:00Z'), now, t, fallback)).toBe('projects.ago.yesterday');
    expect(relativeTime(new Date('2026-10-31T12:00:00Z'), now, t, fallback)).toBe('projects.ago.days:3');
    expect(relativeTime(new Date('2026-08-01T12:00:00Z'), now, t, fallback)).toBe('8/1/26');
  });
});
