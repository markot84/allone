  const summaryStats = useMemo(() => {
    const list = campaignsInConvView;
    const total = list.length;

    let totalSpent = 0;
    let totalConversions = 0;
    let totalConversionValue = 0;

    for (const c of list) {
      totalSpent += c.amount_spent || 0;
      totalConversions += getDisplayConversions(c, convFilterActive);
      totalConversionValue += getDisplayConversionValue(c, convFilterActive);
    }

    const avgROAS = totalSpent > 0 ? totalConversionValue / totalSpent : 0;

    const byChannel: Record<string, number> = {};
    list.forEach(c => {
      const channel = c.channel || 'Other';
      byChannel[channel] = (byChannel[channel] || 0) + 1;
    });

    return {
      total,
      totalSpent,
      totalConversions,
      totalConversionValue,
      avgROAS,
      byChannel,
    };
  }, [campaignsInConvView, convFilterActive]);
