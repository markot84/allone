/**
 * The Signal Board vocabulary — the design language the dashboard is built from, shared.
 *
 * It lived in `components/dashboard/` while the board was the only thing using it. It is the app's
 * card, eyebrow, metric, chip and chart idiom now, so it sits on its own: a page should not have to
 * import from another page's folder to get a card.
 */
export {
  MONO,
  SignalCard,
  SignalEyebrow,
  SignalCardHeader,
  MetricTile,
  SignalChip,
  LegendKey,
  AxisTicks,
  PillButton,
  SignalSkeleton,
  deltaColor,
  directionOf,
  type Delta,
} from './SignalBoard';
export {
  HeroSpark,
  RevenueTrendChart,
  AdsPerformanceChart,
  SegmentShareBar,
  MetricSpark,
  type AdsPoint,
} from './SignalCharts';
export { SignalAlerts } from './SignalAlerts';
