$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$debugRoot = Join-Path $projectRoot '.debugger'
$downloadPath = Join-Path $debugRoot 'cpptools-windows-x64.vsix.gz'
$zipPath = Join-Path $debugRoot 'cpptools-windows-x64.zip'
$extractPath = Join-Path $debugRoot 'cpptools-win'
$adapterPath = Join-Path $extractPath 'extension\debugAdapters\bin\OpenDebugAD7.exe'
$downloadUrl = 'https://marketplace.visualstudio.com/_apis/public/gallery/publishers/ms-vscode/vsextensions/cpptools/1.34.4/vspackage?targetPlatform=win32-x64'

New-Item -ItemType Directory -Path $debugRoot -Force | Out-Null

if (-not (Test-Path -LiteralPath $adapterPath)) {
  Write-Host 'Downloading Microsoft C/C++ debug adapter…'
  & curl.exe -L --fail --retry 3 -o $downloadPath $downloadUrl
  if ($LASTEXITCODE -ne 0) {
    throw 'Unable to download the Microsoft C/C++ debug adapter.'
  }

  $input = [IO.File]::OpenRead($downloadPath)
  $gzip = New-Object IO.Compression.GZipStream(
    $input,
    [IO.Compression.CompressionMode]::Decompress
  )
  $output = [IO.File]::Create($zipPath)
  $gzip.CopyTo($output)
  $output.Dispose()
  $gzip.Dispose()
  $input.Dispose()
  Expand-Archive -LiteralPath $zipPath -DestinationPath $extractPath -Force
}

if (-not (Test-Path -LiteralPath $adapterPath)) {
  throw "Debug adapter was not installed at $adapterPath"
}

Write-Host "C/C++ debug adapter: $adapterPath"
