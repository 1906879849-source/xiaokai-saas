$ErrorActionPreference = 'Stop'

$launcherDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectDir = Split-Path -Parent $launcherDir
$releaseDir = Join-Path $projectDir 'release\KAI画布V1版'
$sourceFile = Join-Path $launcherDir 'KaiCanvas.cs'
$iconFile = Join-Path $launcherDir 'KAI画布.ico'
$outputFile = Join-Path $releaseDir 'KAI画布V1版.exe'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'

if (-not (Test-Path -LiteralPath $compiler)) {
    $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
}
if (-not (Test-Path -LiteralPath $compiler)) {
    throw '没有找到 Windows C# 编译器。'
}

New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null

# Reuse the KAI logo embedded in the canvas so the EXE and website share one identity.
$html = Get-Content -LiteralPath (Join-Path $projectDir 'public\index.html') -Raw
$match = [regex]::Match($html, 'data:image/png;base64,([^"'']+)')
if (-not $match.Success) { throw '没有找到 KAI 画布图标。' }

Add-Type -AssemblyName System.Drawing
$bytes = [Convert]::FromBase64String($match.Groups[1].Value)
$inputStream = New-Object IO.MemoryStream(,$bytes)
$bitmap = New-Object Drawing.Bitmap($inputStream)
$handle = $bitmap.GetHicon()
$icon = [Drawing.Icon]::FromHandle($handle)
$iconStream = [IO.File]::Create($iconFile)
try { $icon.Save($iconStream) } finally { $iconStream.Dispose(); $icon.Dispose(); $bitmap.Dispose(); $inputStream.Dispose() }

& $compiler /nologo /target:winexe /platform:anycpu /optimize+ /win32icon:"$iconFile" /reference:System.Windows.Forms.dll /out:"$outputFile" "$sourceFile"
if ($LASTEXITCODE -ne 0) { throw "启动器编译失败，退出码：$LASTEXITCODE" }

Copy-Item -LiteralPath (Join-Path $launcherDir '客户使用说明.txt') -Destination $releaseDir -Force
Write-Host "已生成：$outputFile"
