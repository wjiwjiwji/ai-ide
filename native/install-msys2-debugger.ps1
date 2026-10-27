$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$debugRoot = Join-Path $projectRoot '.debugger'
$databasePath = Join-Path $debugRoot 'ucrt64.db'
$databaseExtractDirectory = Join-Path $debugRoot 'ucrt64-db'
$downloadDirectory = Join-Path $debugRoot 'packages'
$installDirectory = Join-Path $debugRoot 'msys2'
$databaseUrl = 'https://repo.msys2.org/mingw/ucrt64/ucrt64.db'
$packageBaseUrl = 'https://mirrors.ustc.edu.cn/msys2/mingw/ucrt64/'

New-Item -ItemType Directory -Path $debugRoot -Force | Out-Null
$alreadyInstalledGdb = Join-Path $installDirectory 'ucrt64\bin\gdb.exe'
$alreadyInstalledGxx = Join-Path $installDirectory 'ucrt64\bin\g++.exe'
$headerMarker = Join-Path $installDirectory 'ucrt64\include\c++\16.2.0\bits\hash_bytes.h'
if (
  (Test-Path -LiteralPath $alreadyInstalledGdb) -and
  (Test-Path -LiteralPath $alreadyInstalledGxx) -and
  (Test-Path -LiteralPath $headerMarker) -and
  (Get-Item -LiteralPath $headerMarker).Length -gt 100
) {
  Write-Host "GDB: $alreadyInstalledGdb"
  Write-Host "G++: $alreadyInstalledGxx"
  exit 0
}

New-Item -ItemType Directory -Path $downloadDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $installDirectory -Force | Out-Null

if (-not (Test-Path -LiteralPath $databasePath)) {
  & curl.exe -sSL --fail -o $databasePath $databaseUrl
  if ($LASTEXITCODE -ne 0) {
    throw 'Unable to download the MSYS2 package database.'
  }
}

New-Item -ItemType Directory -Path $databaseExtractDirectory -Force | Out-Null
& tar -xf $databasePath -C $databaseExtractDirectory
if ($LASTEXITCODE -ne 0) {
  throw 'Unable to extract the MSYS2 package database.'
}

$packageDescriptions = @{}

foreach ($descriptionFile in Get-ChildItem -LiteralPath $databaseExtractDirectory -Recurse -Filter 'desc' -File) {
  $lines = @(Get-Content -LiteralPath $descriptionFile.FullName)
  $name = ''
  $fileName = ''
  $checksum = ''
  $dependencies = @()
  $section = ''
  foreach ($line in $lines) {
    if ($line -match '^%(NAME|FILENAME|SHA256SUM|DEPENDS)%$') {
      $section = $Matches[1]
      continue
    }
    if ($line.StartsWith('%')) {
      $section = ''
      continue
    }
    if (-not $line.Trim()) {
      continue
    }
    if ($section -eq 'NAME') {
      $name = $line.Trim()
    } elseif ($section -eq 'FILENAME') {
      $fileName = $line.Trim()
    } elseif ($section -eq 'SHA256SUM') {
      $checksum = $line.Trim()
    } elseif ($section -eq 'DEPENDS' -and $line.Trim()) {
      $dependencies += (($line.Trim() -split '[<>=]+')[0])
    }
  }
  if ($name -and $fileName) {
    $packageDescriptions[$name] = @{
      fileName = $fileName
      checksum = $checksum
      dependencies = $dependencies
    }
  }
}

$requiredPackages = [System.Collections.Generic.List[string]]::new()
$queue = [System.Collections.Generic.Queue[string]]::new()
$queue.Enqueue('mingw-w64-ucrt-x86_64-gcc')
$queue.Enqueue('mingw-w64-ucrt-x86_64-gdb')

while ($queue.Count -gt 0) {
  $name = $queue.Dequeue()
  if ($requiredPackages.Contains($name)) {
    continue
  }
  if (-not $packageDescriptions.ContainsKey($name)) {
    throw "Package dependency not found: $name"
  }
  $requiredPackages.Add($name)
  foreach ($dependency in $packageDescriptions[$name].dependencies) {
    $queue.Enqueue($dependency)
  }
}

foreach ($name in $requiredPackages) {
  $fileName = $packageDescriptions[$name].fileName
  $expectedChecksum = $packageDescriptions[$name].checksum
  $archivePath = Join-Path $downloadDirectory $fileName
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    $actualChecksum = if (Test-Path -LiteralPath $archivePath) {
      (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    } else {
      ''
    }
    if ($actualChecksum -eq $expectedChecksum) {
      break
    }
    Write-Host "Downloading $fileName (attempt $attempt)"
    Remove-Item -LiteralPath $archivePath -Force -ErrorAction SilentlyContinue
    & curl.exe -L --fail --retry 3 --retry-all-errors -o $archivePath ($packageBaseUrl + $fileName)
    if ($LASTEXITCODE -ne 0) {
      Remove-Item -LiteralPath $archivePath -Force -ErrorAction SilentlyContinue
    }
  }
  $actualChecksum = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualChecksum -ne $expectedChecksum) {
    throw "Checksum mismatch for $fileName"
  }
  Write-Host "Extracting $fileName"
  & tar -xf $archivePath -C $installDirectory
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to extract $fileName"
  }
}

$gdb = Join-Path $installDirectory 'ucrt64\bin\gdb.exe'
$gxx = Join-Path $installDirectory 'ucrt64\bin\g++.exe'
$criticalHeaders = @(
  'functexcept.h',
  'gslice_array.h',
  'gslice.h',
  'hash_bytes.h',
  'hashtable_policy.h',
  'indirect_array.h',
  'intcmp.h',
  'istream.tcc'
)
$emptyHeaders = $criticalHeaders | Where-Object {
  $header = Join-Path $installDirectory "ucrt64\include\c++\16.2.0\bits\$_"
  -not (Test-Path -LiteralPath $header) -or
    (Get-Item -LiteralPath $header).Length -eq 0
}
if ($emptyHeaders.Count -gt 0) {
  $gccArchive = Join-Path $downloadDirectory 'mingw-w64-ucrt-x86_64-gcc-16.2.0-6-any.pkg.tar.zst'
  $headerEntries = $emptyHeaders | ForEach-Object {
    "ucrt64/include/c++/16.2.0/bits/$_"
  }
  & tar -xf $gccArchive -C $installDirectory @headerEntries
}

if (-not (Test-Path -LiteralPath $gdb) -or -not (Test-Path -LiteralPath $gxx)) {
  throw 'The MSYS2 GDB/G++ installation is incomplete.'
}
if (-not (Test-Path -LiteralPath $headerMarker) -or (Get-Item -LiteralPath $headerMarker).Length -eq 0) {
  throw 'The GCC standard library headers are incomplete.'
}

Write-Host "GDB: $gdb"
Write-Host "G++: $gxx"
