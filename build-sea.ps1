param(
  [string]$Entry = "server.js",
  [string]$App   = "my-app.exe"
)

$Bundle = "bundle.cjs"
$Blob   = "sea-prep.blob"
$Config = "sea-config.json"

Write-Host "Entry: $Entry"
Write-Host "App:   $App"

# 1) Bundle to CJS with safe globals for SEA
# Note: quoting matters; keep the single quotes inside the define value
npx esbuild $Entry `
  --bundle `
  --platform=node `
  --format=cjs `
  --outfile=$Bundle `
  --banner:js="__dirname = (typeof __dirname !== 'undefined' && __dirname) || process.cwd(); __filename = (typeof __filename !== 'undefined' && __filename) || '/virtual/app.js';" `
  --define:import.meta.url="'file:///virtual/app.js'"

# 2) Generate sea-config.json (embed public/index.html if present)
$assets = @{}
if (Test-Path -Path "public/index.html") {
  $assets["public/index.html"] = "./public/index.html"
}

$cfg = [ordered]@{
  main        = "./$Bundle"
  output      = "./$Blob"
  useCodeCache= $true
  assets      = $assets
}
$cfg | ConvertTo-Json -Depth 5 | Out-File -Encoding UTF8 $Config

# 3) Build SEA blob
node --experimental-sea-config $Config

# 4) Copy Node runtime -> your app
$nodePath = node -p "process.execPath"
[System.IO.File]::Copy($nodePath, $App, $true)

# 5) Inject blob
npx postject $App NODE_SEA_BLOB $Blob `
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2

Write-Host "✔ Built $App"
Write-Host "Run with: .\$App"
