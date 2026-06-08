// Τρέξε: node _tokentest.mjs "PASTE_TO_ACCESS_TOKEN"
// (το token μένει τοπικά — δεν αποθηκεύεται/στέλνεται πουθενά)
const token = process.argv[2];
if (!token) { console.error('Usage: node _tokentest.mjs <ACCESS_TOKEN>'); process.exit(1); }

const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': 'PerformancePlus-TokenTest' };
const base = 'https://www.e-tennis.gr';
const tests = [
  ['storeConfigs', `${base}/rest/V1/store/storeConfigs`],
  ['storeConfigs (index.php)', `${base}/index.php/rest/V1/store/storeConfigs`],
  ['orders (storeviewgreek)', `${base}/rest/storeviewgreek/V1/orders?searchCriteria[pageSize]=1`],
  ['orders (default)', `${base}/rest/V1/orders?searchCriteria[pageSize]=1`],
  ['products (storeviewgreek)', `${base}/rest/storeviewgreek/V1/products?searchCriteria[pageSize]=1`],
];

for (const [label, url] of tests) {
  try {
    const res = await fetch(url, { headers });
    const body = await res.text();
    const snippet = body.replace(/\s+/g, ' ').slice(0, 120);
    console.log(`${res.status}  ${label}`);
    if (!res.ok) console.log(`        → ${snippet}`);
  } catch (e) {
    console.log(`ERR   ${label} → ${e.message}`);
  }
}
