export interface SeasonalPeriod {
  id: string;
  name: string;
  icon: string;
  dateRange: { startMonth: number; startDay: number; endMonth: number; endDay: number };
  suggestedMix: { scenarioA: string; scenarioB: string; percentA: number };
  description: string;
  isCustom?: boolean;
}

export const SEASONAL_PERIODS: SeasonalPeriod[] = [
  {
    id: 'black_friday',
    name: 'Black Friday',
    icon: '🏷️',
    dateRange: { startMonth: 11, startDay: 20, endMonth: 11, endDay: 30 },
    suggestedMix: { scenarioA: 'stock_clearance', scenarioB: 'revenue_push', percentA: 60 },
    description: 'Εκκαθάριση αποθέματος με έμφαση στον τζίρο — ιδανικό για flash sales και aggressive pricing.',
  },
  {
    id: 'christmas',
    name: 'Χριστούγεννα',
    icon: '🎄',
    dateRange: { startMonth: 12, startDay: 1, endMonth: 12, endDay: 24 },
    suggestedMix: { scenarioA: 'revenue_push', scenarioB: 'brand_launch', percentA: 50 },
    description: 'Μεγιστοποίηση τζίρου με παράλληλη ενίσχυση brand awareness μέσω εορταστικών campaigns.',
  },
  {
    id: 'january_sales',
    name: 'Εκπτώσεις Ιανουαρίου',
    icon: '❄️',
    dateRange: { startMonth: 1, startDay: 10, endMonth: 2, endDay: 28 },
    suggestedMix: { scenarioA: 'stock_clearance', scenarioB: 'profit_max', percentA: 70 },
    description: 'Εκκαθάριση εποχιακού stock με διατήρηση κερδοφορίας — balance μεταξύ volume και margin.',
  },
  {
    id: 'easter',
    name: 'Πάσχα',
    icon: '🐣',
    dateRange: { startMonth: 4, startDay: 1, endMonth: 4, endDay: 20 },
    suggestedMix: { scenarioA: 'revenue_push', scenarioB: 'brand_launch', percentA: 60 },
    description: 'Εποχιακή ώθηση πωλήσεων με ευκαιρία προβολής νέων προϊόντων.',
  },
  {
    id: 'july_sales',
    name: 'Εκπτώσεις Ιουλίου',
    icon: '☀️',
    dateRange: { startMonth: 7, startDay: 1, endMonth: 7, endDay: 31 },
    suggestedMix: { scenarioA: 'stock_clearance', scenarioB: 'profit_max', percentA: 60 },
    description: 'Καλοκαιρινές εκπτώσεις — εκκαθάριση ανοιξιάτικου αποθέματος με στόχο κερδοφόρες πωλήσεις.',
  },
  {
    id: 'back_to_school',
    name: 'Back to School',
    icon: '📚',
    dateRange: { startMonth: 9, startDay: 1, endMonth: 9, endDay: 20 },
    suggestedMix: { scenarioA: 'revenue_push', scenarioB: 'stock_clearance', percentA: 50 },
    description: 'Ώθηση πωλήσεων σε σχολικά/εποχιακά προϊόντα με παράλληλη εκκαθάριση καλοκαιρινού stock.',
  },
  {
    id: 'spring_collection',
    name: 'Ανοιξιάτικη Συλλογή',
    icon: '🌸',
    dateRange: { startMonth: 3, startDay: 1, endMonth: 3, endDay: 31 },
    suggestedMix: { scenarioA: 'brand_launch', scenarioB: 'revenue_push', percentA: 60 },
    description: 'Λανσάρισμα ανοιξιάτικης συλλογής με ισχυρό brand push — ιδανική περίοδος για νέα προϊόντα και awareness campaigns.',
  },
  {
    id: 'mothers_day',
    name: "Γιορτή Μητέρας",
    icon: '💐',
    dateRange: { startMonth: 5, startDay: 1, endMonth: 5, endDay: 12 },
    suggestedMix: { scenarioA: 'revenue_push', scenarioB: 'profit_max', percentA: 55 },
    description: 'Εποχιακή ευκαιρία για gift-oriented campaigns με υψηλές μετατροπές και premium προϊόντα.',
  },
  {
    id: 'valentines',
    name: "Αγίου Βαλεντίνου",
    icon: '❤️',
    dateRange: { startMonth: 2, startDay: 1, endMonth: 2, endDay: 14 },
    suggestedMix: { scenarioA: 'revenue_push', scenarioB: 'profit_max', percentA: 50 },
    description: 'Στοχευμένες προσφορές σε δώρα και premium προϊόντα — γρήγορες αποφάσεις, υψηλό AOV.',
  },
];

const LOOKAHEAD_DAYS = 14;

function dayOfYear(month: number, day: number): number {
  const d = new Date(2024, month - 1, day);
  const start = new Date(2024, 0, 1);
  return Math.floor((d.getTime() - start.getTime()) / 86400000);
}

export function getActiveSeasons(date: Date = new Date()): SeasonalPeriod[] {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const today = dayOfYear(m, d);

  return SEASONAL_PERIODS.filter(period => {
    const start = dayOfYear(period.dateRange.startMonth, period.dateRange.startDay);
    const end = dayOfYear(period.dateRange.endMonth, period.dateRange.endDay);
    const lookaheadStart = start - LOOKAHEAD_DAYS;
    return today >= lookaheadStart && today <= end;
  });
}

export function getUpcomingSeason(date: Date = new Date()): SeasonalPeriod | null {
  const active = getActiveSeasons(date);
  return active.length > 0 ? active[0] : null;
}

export function isSeasonActive(periodId: string, date: Date = new Date()): boolean {
  return getActiveSeasons(date).some(p => p.id === periodId);
}
