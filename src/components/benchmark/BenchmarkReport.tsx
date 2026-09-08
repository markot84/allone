import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { PageHeader } from '../common';
import {
  BenchmarkBand,
  LegendKey,
  AxisTicks,
  MetricTile,
  PillButton,
  SeasonalityCompareChart,
  SignalCard,
  SignalCardHeader,
  SignalSkeleton,
  MONO,
} from '../signal';
import { useBenchmarks } from '../../hooks/useBenchmarks';
import {
  BENCHMARK_METRICS,
  MONTH_LABELS_SHORT,
  describeCohort,
  quartileOf,
  type BenchmarkQuartile,
} from '../../config/benchmarks';
import { coerceToDate } from '../../utils/coerceDate';

/**
 * The Benchmarking Report.
 *
 * It exists to replace an improvised answer. Customers ask how they are doing against the trade and
 * the answer has been coming from memory; every number on this page is one that can be read out
 * loud instead, with the size of the comparison group attached to it.
 *
 * Two things it deliberately does not show: any other shop's absolute figures, and any cohort
 * smaller than the k-anonymity floor. Both are enforced server-side
 * (`functions/src/benchmarkAggregator.ts`) — this page cannot leak what was never written to the
 * document it reads.
 */

type SortMode = 'default' | 'weakest';

const QUARTILE_SEVERITY: Record<BenchmarkQuartile, number> = {
  bottom: 0,
  'lower-mid': 1,
  'upper-mid': 2,
  top: 3,
};

export function BenchmarkReport() {
  const { self, cohort, isPending, unavailableReason } = useBenchmarks();
  const [sortMode, setSortMode] = useState<SortMode>('default');

  const bands = useMemo(() => {
    const rows = BENCHMARK_METRICS.map((metric) => {
      const value = self?.metrics?.[metric.id] ?? null;
      const spread = cohort?.metrics?.[metric.id] ?? null;
      const quartile = value !== null && spread ? quartileOf(value, spread, metric.goodWhenRising) : null;
      return { metric, value, spread, quartile };
    });
    if (sortMode === 'default') return rows;
    // Weakest first. Bands with no verdict sort last: "we cannot say" is not a finding, and putting
    // it above a genuine gap would bury the thing the sort was asked for.
    return [...rows].sort((a, b) => {
      const aRank = a.quartile ? QUARTILE_SEVERITY[a.quartile] : 99;
      const bRank = b.quartile ? QUARTILE_SEVERITY[b.quartile] : 99;
      return aRank - bRank;
    });
  }, [cohort, self, sortMode]);

  const ownSeasonality = self?.seasonality ?? null;
  const cohortSeasonality = useMemo(() => {
    if (!cohort?.seasonality || cohort.seasonality.length !== 12) return null;
    return [...cohort.seasonality].sort((a, b) => a.month.localeCompare(b.month)).map((point) => point.index);
  }, [cohort]);

  const updatedAt = coerceToDate(cohort?.updatedAt ?? self?.updatedAt);
  const behindCount = bands.filter((band) => band.quartile === 'bottom' || band.quartile === 'lower-mid').length;
  const aheadCount = bands.filter((band) => band.quartile === 'top' || band.quartile === 'upper-mid').length;
  /** Metrics with no verdict — we cannot report them, or too few shops could. Shown so the two
   *  counts above add up to the number of bands instead of quietly losing one. */
  const unrankedCount = bands.length - behindCount - aheadCount;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
      <PageHeader
        eyebrow="BENCHMARKING"
        title="Benchmarking Report"
        description="Πού στέκεσαι απέναντι σε άλλα e-shops του κλάδου και του μεγέθους σου. Κάθε νούμερο είναι διάμεσος ή ποσοστημόριο πάνω σε ανώνυμα, συγκεντρωτικά δεδομένα· κανένα μεμονωμένο κατάστημα δεν εμφανίζεται και κανένας απόλυτος τζίρος δεν φεύγει από το κατάστημά του."
        actions={
          // No cohort means no bands, and a sort control over nothing is furniture.
          !cohort ? undefined : (
          <div style={{ display: 'flex', gap: 8 }}>
            <PillButton active={sortMode === 'default'} onClick={() => setSortMode('default')}>
              Σειρά μετρικών
            </PillButton>
            <PillButton
              active={sortMode === 'weakest'}
              tone="var(--orange-600)"
              onClick={() => setSortMode('weakest')}
            >
              Πού υστερώ
            </PillButton>
          </div>
          )
        }
      />

      {isPending ? (
        <LoadingState />
      ) : unavailableReason ? (
        <UnavailableState reason={unavailableReason} />
      ) : !self ? (
        <UnavailableState reason="not_built" />
      ) : !cohort ? (
        <UnavailableState reason="no_cohort" />
      ) : (
        <>
          <SignalCard>
            <SignalCardHeader
              eyebrow="Ομάδα σύγκρισης"
              title={describeCohort(cohort.vertical, cohort.sizeBand, cohort.brandCount)}
            />
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                gap: 20,
                marginTop: 20,
              }}
            >
              <MetricTile
                label="Μπροστά σε"
                value={`${aheadCount}/${bands.length}`}
                valueColor={aheadCount > 0 ? 'var(--success-700)' : undefined}
              />
              <MetricTile
                label="Πίσω σε"
                value={`${behindCount}/${bands.length}`}
                valueColor={behindCount > 0 ? 'var(--danger-700)' : undefined}
              />
              <MetricTile label="Χωρίς σύγκριση" value={`${unrankedCount}/${bands.length}`} />
            </div>
            <p style={{ margin: '18px 0 0', fontSize: 12, lineHeight: 1.55, color: 'var(--text-muted)' }}>
              Μια σύγκριση δημοσιεύεται μόνο με τουλάχιστον {cohort.minCohortBrands} καταστήματα μέσα της. Όπου ο
              κλάδος σου είναι πολύ μικρός για αυτό, η σύγκριση διευρύνεται αυτόματα — γι' αυτό η ομάδα εδώ μπορεί να
              είναι ευρύτερη από τον κλάδο σου.
              {updatedAt ? ` Τελευταίος υπολογισμός: ${updatedAt.toLocaleDateString('el-GR')}.` : ''}
            </p>
          </SignalCard>

          <SignalCard>
            <SignalCardHeader eyebrow="Η θέση μας" title="Πώς συγκρίνεσαι, μετρική προς μετρική" />
            <div style={{ display: 'flex', flexDirection: 'column', marginTop: 20 }}>
              {bands.map((band, index) => (
                <motion.div
                  key={band.metric.id}
                  layout
                  transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                  style={{
                    paddingTop: index === 0 ? 0 : 20,
                    paddingBottom: index === bands.length - 1 ? 0 : 20,
                    borderTop: index === 0 ? undefined : '1px solid var(--navy-50)',
                  }}
                >
                  <BenchmarkBand
                    label={band.metric.label}
                    question={band.metric.question}
                    definition={band.metric.definition}
                    value={band.value}
                    spread={band.spread}
                    format={band.metric.format}
                    goodWhenRising={band.metric.goodWhenRising}
                    revealDelay={index * 0.06}
                  />
                </motion.div>
              ))}
            </div>
          </SignalCard>

          <SignalCard>
            <SignalCardHeader eyebrow="Εποχικότητα" title="Πότε αγοράζει ο κλάδος, πότε αγοράζει από εσένα" />
            {cohortSeasonality ? (
              <>
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '6px 18px',
                    margin: '14px 0 10px',
                    fontFamily: MONO,
                    fontSize: 10.5,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: 'var(--text-secondary)',
                  }}
                >
                  <LegendKey color="var(--sky-500)">Κλάδος</LegendKey>
                  {ownSeasonality && <LegendKey color="var(--orange-500)">Εμείς</LegendKey>}
                  <LegendKey color="var(--text-muted)">Μέσος μήνας = 100</LegendKey>
                </div>
                {/* Twelve month labels are wide content: below ~480px they collide into one grey
                    smear. The chart and its ticks scroll together inside their own container so the
                    months stay readable and the page itself never scrolls sideways. */}
                <div style={{ overflowX: 'auto' }}>
                  <div style={{ minWidth: 480 }}>
                    <SeasonalityCompareChart
                      cohort={cohortSeasonality}
                      own={ownSeasonality}
                      monthLabels={MONTH_LABELS_SHORT}
                    />
                    <AxisTicks ticks={MONTH_LABELS_SHORT} />
                  </div>
                </div>
                <p style={{ margin: '16px 0 0', fontSize: 12, lineHeight: 1.55, color: 'var(--text-muted)' }}>
                  Κάθε κατάστημα κανονικοποιείται στον δικό του μέσο μήνα πριν μπει στη διάμεσο, άρα η καμπύλη δείχνει
                  σχήμα χρονιάς και όχι μέγεθος. Οι μήνες όπου η δική σου γραμμή πέφτει κάτω από του κλάδου είναι
                  ζήτηση που υπάρχει και δεν την πιάνεις.
                  {!ownSeasonality && ' Η δική σου καμπύλη χρειάζεται 12 συνεχόμενους πλήρεις μήνες πωλήσεων.'}
                </p>
              </>
            ) : (
              <p style={{ margin: '16px 0 0', fontSize: 13, lineHeight: 1.55, color: 'var(--text-secondary)' }}>
                Δεν υπάρχουν αρκετά καταστήματα με πλήρη δωδεκάμηνο ιστορικό σε αυτή την ομάδα για να βγει καμπύλη
                εποχικότητας.
              </p>
            )}
          </SignalCard>
        </>
      )}
    </div>
  );
}

/** Fixed heights, so nothing on the page moves when the data lands. */
function LoadingState() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <SignalCard>
        <SignalSkeleton height={14} width={120} />
        <div style={{ marginTop: 10 }}>
          <SignalSkeleton height={24} width="60%" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 20, marginTop: 20 }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <SignalSkeleton key={i} height={44} />
          ))}
        </div>
      </SignalCard>
      <SignalCard>
        <SignalSkeleton height={14} width={100} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28, marginTop: 24 }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <SignalSkeleton key={i} height={78} />
          ))}
        </div>
      </SignalCard>
      <SignalCard>
        <SignalSkeleton height={14} width={110} />
        <div style={{ marginTop: 20 }}>
          <SignalSkeleton height={220} />
        </div>
      </SignalCard>
    </div>
  );
}

const UNAVAILABLE_COPY: Record<string, { title: string; body: string }> = {
  opted_out: {
    title: 'Το brand έχει εξαιρεθεί από το benchmarking',
    body: 'Δεν συμμετέχει στις ανώνυμες συγκρίσεις, οπότε δεν έχει και δική του θέση μέσα σε αυτές — δεν δίνει δείγμα, δεν παίρνει σύγκριση. Η εξαίρεση αίρεται από τον διαχειριστή της πλατφόρμας.',
  },
  insufficient_data: {
    title: 'Δεν υπάρχουν αρκετά δεδομένα ακόμη',
    body: 'Το benchmarking χρειάζεται συνδεδεμένο e-shop με ουσιαστικό αριθμό παραγγελιών και τζίρο στους τελευταίους δώδεκα μήνες. Μόλις συγκεντρωθούν, η σελίδα γεμίζει από τον επόμενο ημερήσιο υπολογισμό.',
  },
  no_cohort: {
    title: 'Δεν υπάρχει ακόμη ομάδα σύγκρισης',
    body: 'Καμία ομάδα δεν έχει αρκετά καταστήματα μέσα της για να δημοσιευθεί. Το κατώφλι είναι εκεί επίτηδες: με λιγότερα, μια «διάμεσος» θα ήταν φωτογραφία συγκεκριμένου ανταγωνιστή.',
  },
  not_built: {
    title: 'Το benchmarking δεν έχει υπολογιστεί ακόμη',
    body: 'Ο υπολογισμός τρέχει μία φορά την ημέρα για όλα τα καταστήματα. Αν μόλις συνδέθηκε το e-shop, η σύγκριση εμφανίζεται στον επόμενο κύκλο.',
  },
};

function UnavailableState({ reason }: { reason: string }) {
  const copy = UNAVAILABLE_COPY[reason] ?? UNAVAILABLE_COPY.not_built;
  return (
    <SignalCard>
      <SignalCardHeader eyebrow="Καμία σύγκριση" title={copy.title} />
      <p style={{ margin: '14px 0 0', fontSize: 13.5, lineHeight: 1.6, color: 'var(--text-secondary)', maxWidth: '70ch' }}>
        {copy.body}
      </p>
    </SignalCard>
  );
}
