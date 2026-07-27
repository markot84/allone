# Εκτέλεση ΜΙΑ ΦΟΡΑ τοπικά (χρειάζεται: firebase login, δικαιώματα στο active Firebase project — βλ. .firebaserc)
# Ορίζει τα secrets που ΔΕΝ μπορούν να μπουν στο git (mailbox + κωδικός).

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "=== Performance+ — ορισμός SMTP secrets (Firebase) ===" -ForegroundColor Cyan
Write-Host "Θα ζητηθούν δύο τιμές: πλήρες email mailbox και κωδικός (δεν αποθηκεύονται σε αρχείο)." -ForegroundColor Gray
Write-Host ""

firebase functions:secrets:set SMTP_EMAIL
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

firebase functions:secrets:set SMTP_PASSWORD
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "OK. Τώρα deploy functions:" -ForegroundColor Green
Write-Host "  npm run build" 
Write-Host "  cd .." 
Write-Host "  firebase deploy --only functions" 
Write-Host ""
