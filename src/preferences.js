export const DEFAULT_LAYOUT = Object.freeze({ defaultView: 'week', weekStartsOn: 1, density: 'comfortable', accent: 'indigo', showTasks: true, showStats: true });
export function normalizeLayout(input = {}) {
  if (!input || typeof input !== 'object') input = {};
  return {
    defaultView: ['day', 'week', 'month'].includes(input.defaultView) ? input.defaultView : 'week',
    weekStartsOn: Number(input.weekStartsOn) === 0 ? 0 : 1,
    density: input.density === 'compact' ? 'compact' : 'comfortable',
    accent: ['indigo', 'forest', 'rose'].includes(input.accent) ? input.accent : 'indigo',
    showTasks: input.showTasks !== false,
    showStats: input.showStats !== false,
  };
}
