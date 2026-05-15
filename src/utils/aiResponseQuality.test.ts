import { describe, expect, it } from 'vitest';
import { evaluateAdvisoryResponse } from './aiResponseQuality';

describe('evaluateAdvisoryResponse', () => {
  it('accepts grounded commercial advice with a clear action', () => {
    const findings = evaluateAdvisoryResponse(
      'Το dead stock δεσμεύει κεφάλαιο και χρειάζεται άμεση εμπορική προτεραιότητα. Ελέγξτε τα προϊόντα με υψηλή αξία και ανοίξτε στοχευμένη προσφορά.',
      ['dead stock', 'κεφάλαιο']
    );

    expect(findings).toEqual([]);
  });

  it('flags hype and missing action', () => {
    const findings = evaluateAdvisoryResponse(
      'Αυτή είναι απίστευτη ευκαιρία για εκρηκτική ανάπτυξη.',
      ['ROAS']
    );

    expect(findings.map((f) => f.code)).toContain('forbidden_hype');
    expect(findings.map((f) => f.code)).toContain('missing_action');
    expect(findings.map((f) => f.code)).toContain('missing_evidence');
  });

  it('flags numeric advice without grounding terms', () => {
    const findings = evaluateAdvisoryResponse('Αυξήστε budget κατά 20% στο κανάλι.');

    expect(findings.map((f) => f.code)).toContain('invented_number_risk');
  });
});
