# build-sea.ps1

[CmdletBinding()]
param(
    [string]$Entry = "server.js",
    [string]$App   = "bplus-search.exe"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# UTF-8 console
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding  = [System.Text.Encoding]::UTF8
$OutputEncoding           = [System.Text.Encoding]::UTF8

# Default encoding for some cmdlets
$PSDefaultParameterValues['Out-File:Encoding']    = 'utf8'
$PSDefaultParameterValues['Set-Content:Encoding'] = 'utf8'
$PSDefaultParameterValues['Add-Content:Encoding'] = 'utf8'

$Bundle = "bundle.cjs"
$Blob   = "sea-prep.blob"
$Config = "sea-config.json"

Write-Host "Entry: $Entry"
Write-Host "App:   $App"

# 1) Bundle to CJS with safe globals for SEA

# This is literal JS code as a string:
# __dirname and __filename fall back to safe defaults in SEA.
$banner = "__dirname = (typeof __dirname !== 'undefined' && __dirname) || process.cwd(); __filename = (typeof __filename !== 'undefined' && __filename) || '/virtual/app.js';"

# Valid absolute Windows file URL so fileURLToPath(import.meta.url) works
$importMeta = "'file:///C:/virtual/app.js'"

npx esbuild $Entry `
  --bundle `
  --platform=node `
  --format=cjs `
  --outfile=$Bundle `
  "--banner:js=$banner" `
  "--define:import.meta.url=$importMeta" `
  --external:better-sqlite3 `
  --external:node-gyp-build `
  --external:node-gyp-build-optional-packages

if ($LASTEXITCODE -ne 0) {
    throw "esbuild failed with exit code $LASTEXITCODE"
}


# 2) Generate sea-config.json (embed public/index.html if present)

$assets = @{}
if (Test-Path "public/index.html") {
    $assets["public/index.html"] = "./public/index.html"
}

$configObject = [ordered]@{
    main         = "./$Bundle"
    output       = "./$Blob"
    useCodeCache = $true
    assets       = $assets
}

$json = $configObject | ConvertTo-Json -Depth 8

# Write UTF-8 without BOM (SEA JSON parser hates BOM)
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($Config, $json, $utf8NoBom)

# 3) Build SEA blob
node --experimental-sea-config $Config
if ($LASTEXITCODE -ne 0) {
    throw "SEA blob generation failed with exit code $LASTEXITCODE"
}

# 4) Copy Node runtime -> your app
$nodePath = (Get-Command node -ErrorAction Stop).Source
Copy-Item -LiteralPath $nodePath -Destination $App -Force

# 5) macOS codesign step skipped on Windows

# 6) Inject blob
npx postject $App NODE_SEA_BLOB $Blob `
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2

if ($LASTEXITCODE -ne 0) {
    throw "postject failed with exit code $LASTEXITCODE"
}

Write-Host ("Built " + $App)
Write-Host ('Run with: .\' + $App)
