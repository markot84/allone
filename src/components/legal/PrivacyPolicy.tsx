export function PrivacyPolicy() {
  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '48px 24px', fontFamily: 'system-ui, sans-serif', color: '#1A1A1A', lineHeight: 1.7 }}>
      <header style={{ marginBottom: 40, borderBottom: '2px solid #111', paddingBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <img src="/logo-icon.svg" alt="Performance+" style={{ height: 32 }} onError={e => (e.currentTarget.style.display = 'none')} />
          <span style={{ fontSize: 20, fontWeight: 700 }}>Performance+</span>
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>Πολιτική Απορρήτου</h1>
        <p style={{ color: '#6B7280', fontSize: 14, marginTop: 8 }}>
          Τελευταία ενημέρωση: 13 Μαρτίου 2026
        </p>
      </header>

      <Section title="1. Ταυτότητα Υπεύθυνου Επεξεργασίας">
        <p>
          <strong>Επωνυμία:</strong> notthesame.ai (Performance+ by notthesame.ai)<br />
          <strong>Έδρα:</strong> Θεσσαλονίκη, Ελλάδα<br />
          <strong>Τηλέφωνο:</strong> 2310.321625<br />
          <strong>Email:</strong> <a href="mailto:noreply@performanceplus.gr">noreply@performanceplus.gr</a><br />
          <strong>Website:</strong> <a href="https://performanceplus.gr">performanceplus.gr</a>
        </p>
      </Section>

      <Section title="2. Δεδομένα που Συλλέγουμε">
        <h4 style={h4}>2.1 Δεδομένα Λογαριασμού</h4>
        <ul>
          <li>Email, όνομα (μέσω Google Sign-In ή email/password)</li>
          <li>Brand/εταιρικά στοιχεία που εισάγετε</li>
        </ul>

        <h4 style={h4}>2.2 Δεδομένα από Τρίτες Πλατφόρμες (OAuth Connectors)</h4>
        <p>Κατόπιν ρητής σύνδεσης και συγκατάθεσής σας, ανακτούμε δεδομένα από:</p>
        <table style={tableStyle}>
          <thead>
            <tr style={thRow}>
              <th style={th}>Πλατφόρμα</th>
              <th style={th}>Scope</th>
              <th style={th}>Δεδομένα</th>
              <th style={th}>Σκοπός</th>
            </tr>
          </thead>
          <tbody>
            <tr style={tdRow}>
              <td style={td}>Google Ads</td>
              <td style={tdMono}>adwords</td>
              <td style={td}>Campaigns, μετρικά (impressions, clicks, conversions, cost), search terms, keywords</td>
              <td style={td}>Analytics dashboard, αυτοματισμοί απόδοσης</td>
            </tr>
            <tr style={tdRow}>
              <td style={td}>Google Merchant Center</td>
              <td style={tdMono}>content</td>
              <td style={td}>Price benchmarks, suggested prices ανά SKU</td>
              <td style={td}>Competitive Intelligence, σύγκριση τιμών αγοράς</td>
            </tr>
            <tr style={tdRow}>
              <td style={td}>Google Analytics 4</td>
              <td style={tdMono}>analytics.readonly</td>
              <td style={td}>Sessions, users, pageviews, traffic sources, top pages (read-only)</td>
              <td style={td}>Website performance analytics</td>
            </tr>
            <tr style={tdRow}>
              <td style={td}>Meta (Facebook/Instagram)</td>
              <td style={tdMono}>ads_read</td>
              <td style={td}>Ad campaigns, μετρικά (spend, conversions, ROAS)</td>
              <td style={td}>Cross-channel campaign analytics</td>
            </tr>
          </tbody>
        </table>
        <p style={{ fontSize: 13, color: '#6B7280' }}>
          Δεν τροποποιούμε, δημιουργούμε ή διαγράφουμε δεδομένα στις πλατφόρμες σας.
          Η πρόσβαση είναι αποκλειστικά read-only.
        </p>

        <h4 style={h4}>2.3 Δεδομένα Προϊόντων & Πελατολογίου</h4>
        <ul>
          <li>Κατάλογος προϊόντων (SKU, τιμή, απόθεμα, κατηγορία)</li>
          <li>Aggregated RFM segments (δεν αποθηκεύουμε PII πελατών σας)</li>
          <li>Παραγγελίες σε aggregated μορφή</li>
        </ul>

        <h4 style={h4}>2.4 Δεδομένα Χρήσης</h4>
        <ul>
          <li>Firebase Analytics: anonymized usage patterns</li>
          <li>Crash reports μέσω Firebase Crashlytics</li>
        </ul>
      </Section>

      <Section title="3. Νομική Βάση Επεξεργασίας (GDPR)">
        <ul>
          <li><strong>Συγκατάθεση (Art. 6.1.a):</strong> Σύνδεση OAuth connectors, cookies</li>
          <li><strong>Εκτέλεση σύμβασης (Art. 6.1.b):</strong> Παροχή υπηρεσίας Performance+</li>
          <li><strong>Έννομο συμφέρον (Art. 6.1.f):</strong> Βελτίωση υπηρεσίας, ασφάλεια</li>
        </ul>
      </Section>

      <Section title="4. Αποθήκευση & Ασφάλεια Δεδομένων">
        <ul>
          <li><strong>Υποδομή:</strong> Google Cloud Platform (Firebase), region: europe-west1 (Βέλγιο, ΕΕ)</li>
          <li><strong>Κρυπτογράφηση:</strong> TLS 1.3 σε μεταφορά, AES-256 σε αποθήκευση (Google Cloud default encryption)</li>
          <li><strong>OAuth Tokens:</strong> Αποθηκεύονται κρυπτογραφημένα στο Firebase Firestore. Refresh tokens χρησιμοποιούνται μόνο server-side (Cloud Functions)</li>
          <li><strong>Πρόσβαση:</strong> Μόνο authenticated χρήστες με Firebase Auth ID token</li>
        </ul>
      </Section>

      <Section title="5. Χρήση Τεχνητής Νοημοσύνης (AI)">
        <div style={{ background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 8, padding: 16, marginBottom: 16 }}>
          <p style={{ fontWeight: 600, margin: '0 0 8px' }}>Σημαντική Ενημέρωση — EU AI Act Compliance</p>
          <p style={{ margin: 0, fontSize: 14 }}>
            Η εφαρμογή Performance+ χρησιμοποιεί τεχνητή νοημοσύνη (Google Gemini API) για τη δημιουργία
            προτάσεων, αναλύσεων και στρατηγικών συστάσεων. Τα AI-generated αποτελέσματα:
          </p>
        </div>
        <ul>
          <li>Αποτελούν <strong>αυτοματοποιημένες προτάσεις</strong>, όχι τελικές αποφάσεις</li>
          <li>Ο τελικός χρήστης φέρει <strong>πλήρη ευθύνη</strong> για κάθε απόφαση βασισμένη σε AI output</li>
          <li>Τα AI μοντέλα μπορεί να παράγουν <strong>ανακριβή ή ελλιπή</strong> αποτελέσματα</li>
          <li>Δεν υποκαθιστούν επαγγελματική συμβουλή (νομική, οικονομική, λογιστική)</li>
          <li>Τα δεδομένα που αποστέλλονται στο AI API δεν αποθηκεύονται μόνιμα από τον πάροχο AI</li>
        </ul>
        <p>
          Σύμφωνα με τον <strong>Κανονισμό (ΕΕ) 2024/1689 (EU AI Act)</strong>, το σύστημα AI της εφαρμογής
          κατατάσσεται ως <strong>minimal risk</strong> (decision-support tool χωρίς αυτόνομη λήψη αποφάσεων).
          Παρέχουμε πλήρη διαφάνεια ως προς τη χρήση AI μέσω σαφών ενδείξεων στο UI.
        </p>
      </Section>

      <Section title="6. Διαβίβαση Δεδομένων σε Τρίτους">
        <ul>
          <li><strong>Google Cloud / Firebase:</strong> Υποδομή hosting & βάσης δεδομένων (ΕΕ)</li>
          <li><strong>Google Gemini API:</strong> Για AI-generated content (δεδομένα δεν αποθηκεύονται)</li>
          <li><strong>Δεν πωλούμε</strong> ούτε μοιραζόμαστε δεδομένα με τρίτους για διαφημιστικούς σκοπούς</li>
        </ul>
      </Section>

      <Section title="7. Δικαιώματα Υποκειμένου (GDPR)">
        <p>Έχετε δικαίωμα:</p>
        <ul>
          <li><strong>Πρόσβασης:</strong> Να μάθετε ποια δεδομένα σας τηρούμε</li>
          <li><strong>Διόρθωσης:</strong> Να ζητήσετε διόρθωση ανακριβών δεδομένων</li>
          <li><strong>Διαγραφής:</strong> Να ζητήσετε πλήρη διαγραφή ("right to be forgotten")</li>
          <li><strong>Φορητότητας:</strong> Να λάβετε τα δεδομένα σας σε μηχαναγνώσιμη μορφή</li>
          <li><strong>Ανάκλησης συγκατάθεσης:</strong> Ανά πάσα στιγμή, μέσω αποσύνδεσης connectors</li>
          <li><strong>Εναντίωσης:</strong> Στην αυτοματοποιημένη επεξεργασία</li>
        </ul>
        <p>
          Για άσκηση δικαιωμάτων: <a href="mailto:noreply@performanceplus.gr">noreply@performanceplus.gr</a> ή
          τηλ. <strong>2310.321625</strong>. Απαντάμε εντός 30 ημερών.
        </p>
      </Section>

      <Section title="8. Χρόνος Διατήρησης">
        <ul>
          <li>Δεδομένα λογαριασμού: Όσο διατηρείται ο λογαριασμός + 30 ημέρες μετά τη διαγραφή</li>
          <li>Campaign/analytics data: Έως 3 χρόνια ιστορικό</li>
          <li>OAuth tokens: Ανανεώνονται αυτόματα, διαγράφονται κατά αποσύνδεση</li>
          <li>Automation alerts: Αυτόματη διαγραφή μετά από 30 ημέρες (dismissed/acted)</li>
        </ul>
      </Section>

      <Section title="9. Cookies">
        <p>
          Χρησιμοποιούμε μόνο <strong>αναγκαία cookies</strong> (Firebase Auth session).
          Δεν χρησιμοποιούμε cookies τρίτων για διαφήμιση ή tracking.
        </p>
      </Section>

      <Section title="10. Τροποποιήσεις">
        <p>
          Διατηρούμε το δικαίωμα ενημέρωσης αυτής της πολιτικής. Σε ουσιαστικές αλλαγές
          θα ενημερωθείτε μέσω email ή in-app notification.
        </p>
      </Section>

      <Section title="11. Αρχή Προστασίας Δεδομένων">
        <p>
          Αν θεωρείτε ότι παραβιάζονται τα δικαιώματά σας, μπορείτε να απευθυνθείτε στην
          <strong> Αρχή Προστασίας Δεδομένων Προσωπικού Χαρακτήρα (ΑΠΔΠΧ)</strong>:<br />
          <a href="https://www.dpa.gr" target="_blank" rel="noopener">www.dpa.gr</a> | Τηλ: 210 6475600
        </p>
      </Section>

      <footer style={{ marginTop: 48, paddingTop: 24, borderTop: '1px solid #E5E7EB', color: '#9CA3AF', fontSize: 13 }}>
        <p>© {new Date().getFullYear()} notthesame.ai — Performance+. Με επιφύλαξη παντός δικαιώματος.</p>
        <p>
          <a href="/terms" style={{ color: '#6B7280' }}>Όροι Χρήσης</a> ·{' '}
          <a href="/" style={{ color: '#6B7280' }}>Αρχική</a>
        </p>
      </footer>
    </div>
  );
}

const h4: React.CSSProperties = { fontSize: 15, fontWeight: 600, margin: '20px 0 8px', color: '#111827' };
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13, marginBottom: 16 };
const thRow: React.CSSProperties = { borderBottom: '2px solid #E5E7EB' };
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', fontWeight: 600, color: '#374151' };
const tdRow: React.CSSProperties = { borderBottom: '1px solid #F3F4F6' };
const td: React.CSSProperties = { padding: '8px 12px', verticalAlign: 'top' };
const tdMono: React.CSSProperties = { ...td, fontFamily: 'monospace', fontSize: 12, color: '#6B7280' };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 32 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 12px', color: '#111827' }}>{title}</h2>
      <div style={{ fontSize: 14, color: '#374151' }}>{children}</div>
    </section>
  );
}
