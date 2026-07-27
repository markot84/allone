export type AdvisoryQualityFinding = {
  code: 'missing_evidence' | 'missing_action' | 'forbidden_hype' | 'invented_number_risk';
  message: string;
};

const HYPE_TERMS = [
  'εκρηκτική ανάπτυξη',
  'viral',
  'απίστευτη ευκαιρία',
  'σίγουρη επιτυχία',
  'εγγυημένα αποτελέσματα',
];

const ACTION_VERBS = [
  'ελέγξτε',
  'δείτε',
  'σταματήστε',
  'ενεργοποιήστε',
  'ανοίξτε',
  'αυξήστε',
  'μειώστε',
  'προτεραιοποιήστε',
  'αναθεωρήστε',
  'δοκιμάστε',
];

export function evaluateAdvisoryResponse(text: string, evidenceTerms: string[] = []): AdvisoryQualityFinding[] {
  const normalized = text.toLowerCase();
  const findings: AdvisoryQualityFinding[] = [];

  if (evidenceTerms.length > 0 && !evidenceTerms.some((term) => normalized.includes(term.toLowerCase()))) {
    findings.push({
      code: 'missing_evidence',
      message: 'Η συμβουλή δεν συνδέεται με κανένα από τα αναμενόμενα στοιχεία δεδομένων.',
    });
  }

  if (!ACTION_VERBS.some((verb) => normalized.includes(verb))) {
    findings.push({
      code: 'missing_action',
      message: 'Η συμβουλή δεν περιέχει καθαρή εφαρμόσιμη ενέργεια.',
    });
  }

  if (HYPE_TERMS.some((term) => normalized.includes(term))) {
    findings.push({
      code: 'forbidden_hype',
      message: 'Η συμβουλή περιέχει υπερβολικό ή μη επαγγελματικό ύφος.',
    });
  }

  const percentageOrMoney = /(?:€\s?\d+|\d+(?:[.,]\d+)?\s?%|\d+(?:[.,]\d+)?x)/i;
  if (percentageOrMoney.test(text) && evidenceTerms.length === 0) {
    findings.push({
      code: 'invented_number_risk',
      message: 'Η συμβουλή περιέχει αριθμό χωρίς declared evidence terms για έλεγχο grounding.',
    });
  }

  return findings;
}
