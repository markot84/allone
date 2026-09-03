/** Real app sections — not `inventory` (no such route). */
type GuessResult = { section: string; hashQuery?: string };

export function guessRoute(action: string): GuessResult {
  // PER-337: strip accents so keywords match real AI phrasing («παραγγελία» vs 'παραγγελι').
  const lower = action.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  // Reorder/low-stock before the ecommerce branch — «παραγγελία για προϊόντα με χαμηλό απόθεμα» is a restock, not orders.
  if (lower.includes('χαμηλο αποθεμα') || lower.includes('low stock') || lower.includes('reorder') || lower.includes('restock') || lower.includes('αναπαραγγ') || lower.includes('παραγγειλ') || (lower.includes('παραγγελια') && lower.includes('προιον'))) {
    return { section: 'products', hashQuery: 'stock=low' };
  }
  if (lower.includes('ecom') || lower.includes('eshop') || lower.includes('παραγγελι') || lower.includes('aov') || lower.includes('true roas')) {
    return { section: 'ecommerce' };
  }
  if (lower.includes('dead') || lower.includes('νεκρ')) {
    return { section: 'products', hashQuery: 'stock=dead' };
  }
  if (lower.includes('excess') || lower.includes('πλεονα')) {
    return { section: 'products', hashQuery: 'stock=excess' };
  }
  if (lower.includes('high-margin') || lower.includes('high margin') || lower.includes('αναπληρωσ')) {
    return { section: 'products', hashQuery: 'filter=high-margin-low-stock' };
  }
  const pairs: [string, GuessResult][] = [
    ['campaign', { section: 'campaigns' }],
    ['καμπανι', { section: 'campaigns' }],
    ['stock', { section: 'products' }],
    ['αποθεμα', { section: 'products' }],
    ['inventory', { section: 'products' }],
    ['segment', { section: 'rfm' }],
    ['at risk', { section: 'rfm' }],
    ['champions', { section: 'rfm' }],
    ['rfm', { section: 'rfm' }],
    ['content', { section: 'calendar' }],
    ['strategy', { section: 'strategy' }],
    ['budget', { section: 'channels' }],
    ['roas', { section: 'roi' }],
    ['roi', { section: 'roi' }],
  ];
  for (const [keyword, route] of pairs) {
    if (lower.includes(keyword)) return route;
  }
  return { section: 'dashboard' };
}
