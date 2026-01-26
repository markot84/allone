# Firebase Setup Script for Windows PowerShell

Write-Host "=== Firebase Setup Script ===" -ForegroundColor Cyan
Write-Host ""

# Step 1: Check Firebase CLI
Write-Host "Step 1: Checking Firebase CLI..." -ForegroundColor Yellow
$firebaseVersion = firebase --version 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ Firebase CLI installed: $firebaseVersion" -ForegroundColor Green
} else {
    Write-Host "✗ Firebase CLI not found. Installing..." -ForegroundColor Red
    npm install -g firebase-tools
}

Write-Host ""

# Step 2: Login
Write-Host "Step 2: Firebase Login" -ForegroundColor Yellow
Write-Host "This will open a browser for authentication..." -ForegroundColor Gray
firebase login

if ($LASTEXITCODE -ne 0) {
    Write-Host "✗ Login failed. Please try manually: firebase login" -ForegroundColor Red
    exit 1
}

Write-Host "✓ Login successful" -ForegroundColor Green
Write-Host ""

# Step 3: Check if project exists
Write-Host "Step 3: Checking Firebase projects..." -ForegroundColor Yellow
firebase projects:list

Write-Host ""
Write-Host "=== Next Steps ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. If 'performance-plus' project doesn't exist:" -ForegroundColor Yellow
Write-Host "   - Go to https://console.firebase.google.com/" -ForegroundColor Gray
Write-Host "   - Create new project: performance-plus" -ForegroundColor Gray
Write-Host "   - Enable Hosting" -ForegroundColor Gray
Write-Host ""
Write-Host "2. Initialize hosting:" -ForegroundColor Yellow
Write-Host "   firebase init hosting" -ForegroundColor Gray
Write-Host "   - Select: Use an existing project" -ForegroundColor Gray
Write-Host "   - Select: performance-plus" -ForegroundColor Gray
Write-Host "   - Public directory: dist" -ForegroundColor Gray
Write-Host "   - Single-page app: Yes" -ForegroundColor Gray
Write-Host ""
Write-Host "3. Build and Deploy:" -ForegroundColor Yellow
Write-Host "   npm run build" -ForegroundColor Gray
Write-Host "   firebase deploy --only hosting" -ForegroundColor Gray
Write-Host ""
