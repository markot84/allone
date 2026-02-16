/**
 * Prompt template για AI Channel Recommendations.
 * Μπορείς να τροποποιήσεις το systemPrompt ή το userPrompt για να προσαρμόσεις τη συμπεριφορά.
 *
 * Μεταβλητές που αντικαθίστανται:
 * - {{scenarioName}}: όνομα στρατηγικής (π.χ. Profit Maximization, Stock Clearance)
 * - {{scenarioDescription}}: περιγραφή στρατηγικής
 * - {{segmentName}}: όνομα RFM segment (π.χ. Champions, At Risk)
 * - {{segmentDescription}}: περιγραφή segment
 * - {{segmentCount}}: αριθμός πελατών στο segment
 * - {{revenueShare}}: % revenue share του segment
 */
export const CHANNEL_RECOMMENDATIONS_SYSTEM_PROMPT = `Είσαι ειδικός marketing strategist για e-commerce και retail. Δίνεις συστάσεις καναλιών (Email, Meta Ads, Google Shopping, Remarketing, SMS, κ.λπ.) βάσει:
- Επιλεγμένης εμπορικής στρατηγικής (π.χ. Profit Max, Stock Clearance, Brand Launch)
- RFM segment (Champions, Loyal, Potential, At Risk, Lost)
- Best practices για budget allocation και channel mix

Απάντα ΜΟΝΟ με valid JSON, χωρίς markdown ή εξήγηση. Format:
{
  "primary": ["Channel1", "Channel2"],
  "secondary": ["Channel3"],
  "budget_allocation": { "channel1": 40, "channel2": 35, "channel3": 25 },
  "rationale": "Σύντομη αιτιολόγηση στα Ελληνικά (1-2 προτάσεις)"
}

Κανόνες:
- primary: 2-3 κύρια κανάλια
- secondary: 1-2 δευτερεύοντα
- budget_allocation: αθροιστικά 100, keys σε lowercase (π.χ. email, meta, google)
- rationale: Ελληνικά, συγκεκριμένο για το segment + strategy`;

export function buildChannelRecommendationsUserPrompt(params: {
  scenarioName: string;
  scenarioDescription: string;
  segmentName: string;
  segmentDescription: string;
  segmentCount: number;
  revenueShare: number;
}): string {
  const {
    scenarioName,
    scenarioDescription,
    segmentName,
    segmentDescription,
    segmentCount,
    revenueShare
  } = params;

  return `Στρατηγική: ${scenarioName}
Περιγραφή: ${scenarioDescription}

Segment: ${segmentName}
Περιγραφή: ${segmentDescription}
Πελάτες: ${segmentCount.toLocaleString()}
Revenue share: ${revenueShare}%

Δώσε channel recommendations (primary, secondary, budget_allocation, rationale) σε JSON.`;
}
