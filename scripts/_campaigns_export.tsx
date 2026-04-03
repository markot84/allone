  const handleExportCampaigns = useCallback(() => {
    const list = campaignsInConvView;
    if (list.length === 0) return;
    const headers = ['Name', 'Channel', 'Status', 'Impressions', 'Clicks', 'CTR %', 'Spend', 'Conversions', 'Conv. Value', 'ROAS', 'CPA', 'Start Date', 'End Date'];
    const rows = list.map(c => [
      c.name || '', c.channel || '', c.status || '',
      c.impressions ?? '', c.clicks ?? '',
      c.impressions ? ((c.clicks || 0) / c.impressions * 100).toFixed(2) : '',
      c.amount_spent ?? '', getDisplayConversions(c, convFilterActive), getDisplayConversionValue(c, convFilterActive),
      c.amount_spent ? (getDisplayConversionValue(c, convFilterActive) / c.amount_spent).toFixed(2) : '',
      getDisplayConversions(c, convFilterActive) ? ((c.amount_spent || 0) / getDisplayConversions(c, convFilterActive)).toFixed(2) : '',
      c.start_date || '', c.end_date || '',
    ]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `campaigns_export_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [campaignsInConvView, convFilterActive]);
