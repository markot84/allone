  const applyConvFilter = (c: Campaign): Campaign => {
    if (convActionFilter.length === 0) return c;
    const ca = c.conversionActions;
    if (!ca || Object.keys(ca).length === 0) {
      return {
        ...c,
        conversions: 0,
        conversion_value: 0,
        roas: 0,
      };
    }
    let filteredConversions = 0;
    let filteredValue = 0;
    const purchaseSelected = convActionFilter.includes('Purchase');
    const campaignName = c.name || '';

    for (const action of convActionFilter) {
      if (action === 'Purchase') {
        let purchaseKeys = Object.keys(ca).filter(k => k.toLowerCase().includes('purchase'));
        const googleAdsLike = isGoogleAdsLikeChannel(c.channel);
        if (googleAdsLike) {
          const primary = pickPrimaryGoogleAdsPurchaseKey(purchaseKeys, ca, campaignName);
          purchaseKeys = primary ? [primary] : [];
        }
        for (const pk of purchaseKeys) {
          const row = ca[pk];
          if (!row) continue;
          if (isPhantomStoreVisitPurchaseRow(pk, row, campaignName)) continue;
          filteredConversions += row.conversions ?? 0;
          filteredValue += row.value ?? 0;
        }
      } else {
        if (purchaseSelected && action.toLowerCase().includes('purchase')) continue;
        const a = ca[action];
        if (
          a &&
          !(
            action.toLowerCase().includes('purchase') &&
            isPhantomStoreVisitPurchaseRow(action, a, campaignName)
          )
        ) {
          filteredConversions += a.conversions;
          filteredValue += a.value ?? 0;
        }
      }
    }

    const conversion_value = Math.round(filteredValue * 100) / 100;
    const roas = (c.amount_spent || 0) > 0 ? Math.round((conversion_value / (c.amount_spent || 1)) * 100) / 100 : 0;
    return { ...c, conversions: filteredConversions, conversion_value, roas };
  };

  const campaignsWithConvFilter = useMemo(() => {
    if (convActionFilter.length === 0) return campaignsWithDateMetrics;
    return campaignsWithDateMetrics.map(applyConvFilter);
  }, [campaignsWithDateMetrics, convActionFilter]);

  const campaignsInConvView = useMemo(() => {
    if (!convFilterActive) return campaignsWithConvFilter;
    return campaignsWithConvFilter.filter(
      c => getDisplayConversions(c, true) > 0 || getDisplayConversionValue(c, true) > 0
    );
  }, [campaignsWithConvFilter, convFilterActive]);

  const sortedCampaigns = useMemo(() => {
    if (!sortColumn) return campaignsInConvView;
    const sorted = [...campaignsInConvView].sort((a, b) => {
      let va: string | number = 0;
      let vb: string | number = 0;
      switch (sortColumn) {
        case 'name': va = a.name || ''; vb = b.name || ''; break;
        case 'channel': va = a.channel || ''; vb = b.channel || ''; break;
        case 'period': va = a.period || ''; vb = b.period || ''; break;
        case 'status': va = a.status || ''; vb = b.status || ''; break;
        case 'spent': va = a.amount_spent || 0; vb = b.amount_spent || 0; break;
        case 'impressions': va = a.impressions || 0; vb = b.impressions || 0; break;
        case 'clicks': va = a.clicks || 0; vb = b.clicks || 0; break;
        case 'ctr': va = a.ctr || 0; vb = b.ctr || 0; break;
        case 'conversions': va = getDisplayConversions(a, convFilterActive); vb = getDisplayConversions(b, convFilterActive); break;
        case 'conversion_value': va = getDisplayConversionValue(a, convFilterActive); vb = getDisplayConversionValue(b, convFilterActive); break;
        case 'roas': va = a.roas || 0; vb = b.roas || 0; break;
      }
      if (typeof va === 'string') return sortDirection === 'asc' ? va.localeCompare(vb as string) : (vb as string).localeCompare(va);
      return sortDirection === 'asc' ? (va as number) - (vb as number) : (vb as number) - (va as number);
    });
    return sorted;
  }, [campaignsInConvView, sortColumn, sortDirection, convFilterActive]);
