  // Compute date-range-aware metrics per campaign
  const campaignsWithDateMetrics = useMemo(() => {
    const useDateFilter = !!(dateFrom || dateTo);
    if (!useDateFilter) return filteredCampaigns;

    const fromDate = dateFrom || '0000-00-00';
    const toDate = dateTo || '9999-99-99';

    return filteredCampaigns.map(c => {
      if (!c.dailyMetrics || Object.keys(c.dailyMetrics).length === 0) return c;
      const metaMonthBuckets = (c.channel || '').toLowerCase() === 'meta';
      let impressions = 0, clicks = 0, conversions = 0, amount_spent = 0, conversion_value = 0;
      const dateConvActions: Record<string, { conversions: number; value: number }> = {};
      const countedConvMonths = new Set<string>();

      for (const [date, m] of Object.entries(c.dailyMetrics)) {
        const frac = bucketOverlapFraction(date, fromDate, toDate, { metaMonthBuckets });
        if (frac <= 0) continue;

        impressions += Math.round((m.impressions || 0) * frac);
        clicks += Math.round((m.clicks || 0) * frac);
        conversions += (m.conversions || 0) * frac;
        amount_spent += (m.amount_spent || 0) * frac;
        conversion_value += (m.conversion_value || 0) * frac;

        const mAny = m as Record<string, any>;
        if (mAny.conversionActions && typeof mAny.conversionActions === 'object') {
          const monthKey = date.slice(0, 7);
          if (!countedConvMonths.has(monthKey)) {
            countedConvMonths.add(monthKey);
            for (const [label, vals] of Object.entries(mAny.conversionActions as Record<string, { conversions: number; value: number }>)) {
              if (!dateConvActions[label]) dateConvActions[label] = { conversions: 0, value: 0 };
              dateConvActions[label].conversions += (vals.conversions || 0) * frac;
              dateConvActions[label].value += (vals.value || 0) * frac;
            }
          }
        }
      }

      const conversionActions = dateConvActions;

      const ctr = impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0;
      const roas = amount_spent > 0 ? Math.round((conversion_value / amount_spent) * 100) / 100 : 0;
      amount_spent = Math.round(amount_spent * 100) / 100;
      return { ...c, impressions, clicks, conversions, amount_spent, conversion_value, ctr, roas, conversionActions };
    });
  }, [filteredCampaigns, dateFrom, dateTo]);
