param(
  [switch]$Installer,
  [switch]$CpuOnly,
  [string]$VulkanSdkPath = $env:VULKAN_SDK,
  [string]$NativeBuildRoot = (Join-Path $env:USERPROFILE 'nvk'),
  [ValidateSet('internal', 'canary', 'beta', 'stable')]
  [string]$BuildType = 'internal',
  [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Run this script on Windows.' }
$repository = Split-Path -Parent $PSScriptRoot

foreach ($tool in @('node', 'yarn', 'cargo', 'cmake')) {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
    throw "Missing build tool: $tool. See docs/BUILDING.md."
  }
}
$nodeVersion = & node --version
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v22\.') {
  throw 'Select Node.js 22 before building (see .nvmrc).'
}
$nodeArch = & node -p process.arch
if ($LASTEXITCODE -ne 0 -or $nodeArch -ne 'x64') {
  throw 'This Windows x64 build requires the x64 Node.js runtime.'
}
if (-not [IO.Path]::IsPathRooted($NativeBuildRoot)) {
  throw 'NativeBuildRoot must be a short absolute path.'
}

if (-not $CpuOnly) {
  if (-not $VulkanSdkPath) { $VulkanSdkPath = $env:VK_SDK_PATH }
  if (-not $VulkanSdkPath) {
    $sdkBase = Join-Path $env:SystemDrive 'VulkanSDK'
    if (Test-Path -LiteralPath $sdkBase) {
      $VulkanSdkPath = Get-ChildItem -LiteralPath $sdkBase -Directory |
        Where-Object { $_.Name -match '^\d+\.\d+\.\d+\.\d+$' } |
        Sort-Object { [version]$_.Name } -Descending |
        Select-Object -First 1 -ExpandProperty FullName
    }
  }
  if (-not $VulkanSdkPath) {
    throw 'Vulkan SDK is required. Set VULKAN_SDK or pass -VulkanSdkPath. Use -CpuOnly only for an intentional CPU build.'
  }
  foreach ($sdkFile in @('Bin\glslc.exe', 'Include\vulkan\vulkan.h', 'Lib\vulkan-1.lib')) {
    if (-not (Test-Path -LiteralPath (Join-Path $VulkanSdkPath $sdkFile) -PathType Leaf)) {
      throw "Incomplete Vulkan SDK: missing $sdkFile in $VulkanSdkPath."
    }
  }
}

if ($CheckOnly) {
  [pscustomobject]@{
    VulkanEnabled = -not [bool]$CpuOnly
    VulkanSdkPath = if ($CpuOnly) { $null } else { $VulkanSdkPath }
    NativeBuildRoot = $NativeBuildRoot
    BuildType = $BuildType
    Installer = [bool]$Installer
  }
  return
}

$env:BUILD_TYPE = $BuildType
$env:NODE_OPTIONS = '--max-old-space-size=12288'
$env:NOTA_LOCAL_ASR_BUILD_ROOT = $NativeBuildRoot
$env:NOTA_WHISPER_VULKAN = if ($CpuOnly) { '0' } else { '1' }
$env:NOTA_LLAMA_VULKAN = if ($CpuOnly) { '0' } else { '1' }
Remove-Item Env:NOTA_SKIP_LOCAL_ASR -ErrorAction SilentlyContinue
if (-not $CpuOnly) {
  $env:VULKAN_SDK = $VulkanSdkPath
  $env:VK_SDK_PATH = $VulkanSdkPath
  $env:PATH = (Join-Path $VulkanSdkPath 'Bin') + ';' + $env:PATH
}

function Invoke-Yarn {
  param([string[]]$YarnArgs)
  & yarn @YarnArgs
  if ($LASTEXITCODE -ne 0) { throw "Build failed: yarn $($YarnArgs -join ' ')" }
}

Write-Host "Building Windows x64 ($BuildType), Vulkan enabled: $(-not [bool]$CpuOnly)"
Push-Location $repository
try {
  Invoke-Yarn -YarnArgs @('nota', '@nota/native', 'build')
  Invoke-Yarn -YarnArgs @('nota', '@nota/electron-renderer', 'build')
  Invoke-Yarn -YarnArgs @('nota', '@nota/electron', 'build')

  $webSource = Join-Path $repository 'packages\frontend\apps\electron-renderer\dist'
  $webTarget = [IO.Path]::GetFullPath((Join-Path $repository 'packages\frontend\apps\electron\resources\web-static'))
  $repoPrefix = [IO.Path]::GetFullPath($repository).TrimEnd('\') + '\'
  if (-not $webTarget.StartsWith($repoPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Renderer staging path must stay inside the repository.'
  }
  if (Test-Path -LiteralPath $webTarget) {
    if ((Get-Item -LiteralPath $webTarget).Attributes -band [IO.FileAttributes]::ReparsePoint) {
      throw 'Renderer staging directory must not be a symbolic link or junction.'
    }
    Remove-Item -LiteralPath $webTarget -Recurse -Force
  }
  New-Item -ItemType Directory -Path $webTarget | Out-Null
  Copy-Item -Path (Join-Path $webSource '*') -Destination $webTarget -Recurse -Force
  $env:SKIP_GENERATE_ASSETS = '1'
  Invoke-Yarn -YarnArgs @('nota', '@nota/electron', 'package', '--platform=win32', '--arch=x64')
  if ($Installer) {
    Invoke-Yarn -YarnArgs @('nota', '@nota/electron', 'make-nsis', '--platform=win32', '--arch=x64')
  }
  Write-Host "Windows artifacts: $repository\packages\frontend\apps\electron\out\$BuildType"
} finally {
  Pop-Location
}
