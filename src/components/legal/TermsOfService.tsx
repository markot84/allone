import { AllOneLogo } from '../common';

export function TermsOfService() {
  return (
    <div style={{ height: '100vh', overflowY: 'auto', background: '#fff' }}>
      <main style={{ maxWidth: 820, margin: '0 auto', padding: '48px 24px', fontFamily: 'system-ui, sans-serif', color: '#1A1A1A', lineHeight: 1.7 }}>
      <header style={{ marginBottom: 40, borderBottom: '2px solid #111', paddingBottom: 24 }}>
        <div style={{ marginBottom: 16 }}>
          <AllOneLogo height={40} />
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>Όροι Χρήσης</h1>
        <p style={{ color: '#6B7280', fontSize: 14, marginTop: 8 }}>
          Τελευταία ενημέρωση: 13 Μαρτίου 2026
        </p>
      </header>

      <Section title="1. Γενικά">
        <p>
          Οι παρόντες Όροι Χρήσης διέπουν τη χρήση της πλατφόρμας <strong>Performance+</strong>
          (εφεξής "Υπηρεσία"), που παρέχεται από την <strong>notthesame.ai</strong>
          (εφεξής "Εταιρεία"), με έδρα τη Θεσσαλονίκη, Ελλάδα.
        </p>
        <p>
          <strong>Τηλέφωνο:</strong> 2310.321625<br />
          <strong>Email:</strong> <a href="mailto:noreply@performanceplus.gr">noreply@performanceplus.gr</a>
        </p>
        <p>
          Με τη δημιουργία λογαριασμού ή τη χρήση της Υπηρεσίας αποδέχεστε πλήρως τους
          παρόντες όρους. Αν δεν συμφωνείτε, παρακαλούμε μην χρησιμοποιήσετε την πλατφόρμα.
        </p>
      </Section>

      <Section title="2. Περιγραφή Υπηρεσίας">
        <p>
          Η Performance+ είναι πλατφόρμα SaaS για ανάλυση εμπορικής απόδοσης, business intelligence
          και αυτοματισμούς αποφάσεων. Παρέχει:
        </p>
        <ul>
          <li>Dashboard με KPIs και analytics</li>
          <li>Σύνδεση με πλατφόρμες τρίτων (Google Ads, Meta, Google Merchant Center, GA4)</li>
          <li>AI-powered προτάσεις και στρατηγικές αναλύσεις</li>
          <li>Αυτοματισμούς ειδοποιήσεων και αποφάσεων</li>
          <li>Competitive intelligence και price benchmarking</li>
        </ul>
      </Section>

      <Section title="3. Λογαριασμοί & Πρόσβαση">
        <ul>
          <li>Πρέπει να είστε τουλάχιστον 18 ετών ή νόμιμος εκπρόσωπος εταιρείας</li>
          <li>Είστε υπεύθυνοι για τη διατήρηση ασφάλειας του λογαριασμού σας</li>
          <li>Κάθε λογαριασμός αντιστοιχεί σε ένα ή περισσότερα brands</li>
          <li>Η Εταιρεία δικαιούται να αναστείλει λογαριασμούς σε περίπτωση κατάχρησης</li>
        </ul>
      </Section>

      <Section title="4. Πλάνα & Τιμολόγηση">
        <p>
          Η Υπηρεσία προσφέρεται σε δύο πλάνα: <strong>Performance+ Growth Plan</strong> και
          <strong> Performance+ Enterprise</strong>. Τα χαρακτηριστικά και η τιμολόγηση κάθε πλάνου
          περιγράφονται στη σελίδα τιμολόγησης.
        </p>
        <ul>
          <li>Η χρέωση γίνεται σε μηνιαία ή ετήσια βάση</li>
          <li>Η Εταιρεία δικαιούται να αναπροσαρμόσει τιμές με 30 ημέρες προειδοποίηση</li>
          <li>Η ακύρωση συνδρομής ισχύει στο τέλος της τρέχουσας περιόδου χρέωσης</li>
        </ul>
      </Section>

      <Section title="5. Χρήση Τεχνητής Νοημοσύνης — Αποποίηση Ευθύνης">
        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: 16, marginBottom: 16 }}>
          <p style={{ fontWeight: 700, margin: '0 0 8px', color: '#DC2626' }}>
            ΣΗΜΑΝΤΙΚΗ ΑΠΟΠΟΙΗΣΗ ΕΥΘΥΝΗΣ — AI GENERATED CONTENT
          </p>
          <p style={{ margin: 0, fontSize: 14, color: '#991B1B' }}>
            Η χρήση AI-generated περιεχομένου γίνεται αποκλειστικά με δική σας ευθύνη.
          </p>
        </div>

        <p>Η Υπηρεσία χρησιμοποιεί τεχνολογία τεχνητής νοημοσύνης (AI) μέσω τρίτων παρόχων (Google Gemini). Αναγνωρίζετε και αποδέχεστε ότι:</p>

        <ol>
          <li>
            <strong>Τα AI αποτελέσματα είναι προτάσεις, όχι εγγυήσεις.</strong> Η Εταιρεία δεν εγγυάται
            την ακρίβεια, πληρότητα ή καταλληλότητα οποιουδήποτε AI-generated περιεχομένου.
          </li>
          <li>
            <strong>Δεν υποκαθιστούν επαγγελματική συμβουλή.</strong> Τα AI outputs δεν αποτελούν
            νομική, λογιστική, χρηματοοικονομική ή επιχειρηματική συμβουλή.
          </li>
          <li>
            <strong>Ο χρήστης φέρει πλήρη ευθύνη</strong> για κάθε απόφαση, ενέργεια ή παράλειψη
            βασισμένη σε AI-generated αποτελέσματα.
          </li>
          <li>
            <strong>Τα AI μοντέλα μπορεί να σφάλουν.</strong> Μπορεί να παράγουν ανακριβή, παραπλανητικά,
            ελλιπή ή παρωχημένα αποτελέσματα (hallucinations).
          </li>
          <li>
            <strong>Η Εταιρεία αποποιείται κάθε ευθύνης</strong> για ζημίες (άμεσες, έμμεσες,
            παρεπόμενες ή ειδικές) που προκύπτουν από τη χρήση AI-generated content, συμπεριλαμβανομένων
            ενδεικτικά: λανθασμένων επιχειρηματικών αποφάσεων, οικονομικών απωλειών, απώλειας δεδομένων.
          </li>
          <li>
            <strong>Αυτοματισμοί:</strong> Οι αυτοματοποιημένες ειδοποιήσεις και briefings βασίζονται
            σε κανόνες που ορίζει ο χρήστης. Η Εταιρεία δεν ευθύνεται για αποφάσεις που λαμβάνονται
            αυτόματα χωρίς ανθρώπινη αξιολόγηση.
          </li>
        </ol>

        <h4 style={h4}>EU AI Act (Κανονισμός 2024/1689)</h4>
        <p>
          Σύμφωνα με τον Κανονισμό (ΕΕ) 2024/1689 περί Τεχνητής Νοημοσύνης:
        </p>
        <ul>
          <li>Το AI σύστημα της Performance+ κατατάσσεται ως <strong>minimal risk</strong> (decision-support tool)</li>
          <li>Δεν λαμβάνει αυτόνομες αποφάσεις — ο τελικός χρήστης έχει πάντα τον έλεγχο</li>
          <li>Κάθε AI-generated περιεχόμενο σημειώνεται ρητά στο UI με κατάλληλη ένδειξη</li>
          <li>Παρέχεται πλήρης διαφάνεια ως προς τα δεδομένα που τροφοδοτούν τα AI μοντέλα</li>
          <li>Ο χρήστης μπορεί ανά πάσα στιγμή να απενεργοποιήσει τις AI λειτουργίες</li>
        </ul>
      </Section>

      <Section title="6. Δεδομένα Τρίτων Πλατφορμών">
        <ul>
          <li>
            Η σύνδεση με Google Ads, Meta, Merchant Center, GA4 γίνεται μέσω OAuth 2.0.
            Η Εταιρεία δεν αποθηκεύει τα credentials σας (μόνο encrypted refresh tokens).
          </li>
          <li>
            Η ακρίβεια των δεδομένων εξαρτάται από τις πλατφόρμες προέλευσης.
            Η Εταιρεία δεν ευθύνεται για ασυνέπειες ή λάθη στα δεδομένα τρίτων.
          </li>
          <li>
            Μπορείτε ανά πάσα στιγμή να αποσυνδέσετε οποιαδήποτε πλατφόρμα μέσω
            Συνδέσεις → Disconnect.
          </li>
        </ul>
      </Section>

      <Section title="7. Πνευματική Ιδιοκτησία">
        <ul>
          <li>Η πλατφόρμα Performance+, ο κώδικας, το UI/UX design και το brand ανήκουν στην Εταιρεία</li>
          <li>Τα δεδομένα που εισάγετε παραμένουν δική σας ιδιοκτησία</li>
          <li>Η Εταιρεία δεν αποκτά δικαιώματα στα δεδομένα σας πέραν αυτών που απαιτούνται για την παροχή της Υπηρεσίας</li>
        </ul>
      </Section>

      <Section title="8. Περιορισμός Ευθύνης">
        <p>
          Στο μέγιστο βαθμό που επιτρέπεται από το εφαρμοστέο δίκαιο:
        </p>
        <ul>
          <li>
            Η Υπηρεσία παρέχεται <strong>"ως έχει" (as is)</strong> χωρίς εγγυήσεις
            εμπορευσιμότητας ή καταλληλότητας για συγκεκριμένο σκοπό
          </li>
          <li>
            Η Εταιρεία δεν ευθύνεται για <strong>έμμεσες, παρεπόμενες ή αποθετικές ζημίες</strong>,
            απώλεια κερδών ή δεδομένων
          </li>
          <li>
            Η συνολική ευθύνη της Εταιρείας περιορίζεται στο ποσό που καταβλήθηκε
            για τη συνδρομή κατά τους τελευταίους 12 μήνες
          </li>
          <li>
            Η Εταιρεία δεν ευθύνεται για διακοπές λειτουργίας λόγω τρίτων παρόχων
            (Google Cloud, Meta API, κλπ.) ή ανωτέρας βίας
          </li>
        </ul>
      </Section>

      <Section title="9. Αποδεκτή Χρήση">
        <p>Απαγορεύεται:</p>
        <ul>
          <li>Η χρήση της Υπηρεσίας για παράνομους σκοπούς</li>
          <li>Η αντίστροφη μηχανίκευση (reverse engineering) της πλατφόρμας</li>
          <li>Η μεταπώληση ή αναδιανομή της Υπηρεσίας χωρίς γραπτή άδεια</li>
          <li>Η αυτοματοποιημένη εξαγωγή δεδομένων (scraping) εκτός των παρεχόμενων εργαλείων</li>
          <li>Η εισαγωγή κακόβουλου λογισμικού ή επίθεση στην υποδομή</li>
        </ul>
      </Section>

      <Section title="10. Λύση Σύμβασης">
        <ul>
          <li>Μπορείτε να διαγράψετε τον λογαριασμό σας ανά πάσα στιγμή</li>
          <li>Η Εταιρεία δικαιούται να τερματίσει λογαριασμούς που παραβιάζουν τους Όρους</li>
          <li>Μετά τη λύση, τα δεδομένα σας διαγράφονται εντός 30 ημερών</li>
        </ul>
      </Section>

      <Section title="11. Εφαρμοστέο Δίκαιο & Επίλυση Διαφορών">
        <ul>
          <li>Εφαρμοστέο δίκαιο: <strong>Ελληνικό δίκαιο</strong> και κανονισμοί ΕΕ (GDPR, EU AI Act)</li>
          <li>Αρμόδια δικαστήρια: <strong>Θεσσαλονίκη</strong></li>
          <li>Σε περίπτωση διαφοράς, θα επιδιώκεται πρώτα φιλική επίλυση εντός 30 ημερών</li>
        </ul>
      </Section>

      <Section title="12. Τροποποιήσεις Όρων">
        <p>
          Η Εταιρεία δικαιούται να τροποποιήσει τους παρόντες Όρους. Ουσιαστικές αλλαγές
          θα κοινοποιούνται μέσω email ή in-app notification τουλάχιστον 15 ημέρες πριν
          τεθούν σε ισχύ. Η συνέχιση χρήσης μετά την ενημέρωση συνιστά αποδοχή.
        </p>
      </Section>

      <Section title="13. Επικοινωνία">
        <p>
          Για ερωτήσεις, παράπονα ή αιτήματα σχετικά με τους Όρους Χρήσης:<br />
          <strong>Email:</strong> <a href="mailto:noreply@performanceplus.gr">noreply@performanceplus.gr</a><br />
          <strong>Τηλέφωνο:</strong> 2310.321625<br />
          <strong>Website:</strong> <a href="https://performanceplus.gr">performanceplus.gr</a>
        </p>
      </Section>

      <footer style={{ marginTop: 48, paddingTop: 24, borderTop: '1px solid #E5E7EB', color: '#9CA3AF', fontSize: 13 }}>
        <p>© {new Date().getFullYear()} notthesame.ai — Performance+. Με επιφύλαξη παντός δικαιώματος.</p>
        <p>
          <a href="/privacy" style={{ color: '#6B7280' }}>Πολιτική Απορρήτου</a> ·{' '}
          <a href="/" style={{ color: '#6B7280' }}>Αρχική</a>
        </p>
      </footer>
      </main>
    </div>
  );
}

const h4: React.CSSProperties = { fontSize: 15, fontWeight: 600, margin: '20px 0 8px', color: '#111827' };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 32 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 12px', color: '#111827' }}>{title}</h2>
      <div style={{ fontSize: 14, color: '#374151' }}>{children}</div>
    </section>
  );
}
