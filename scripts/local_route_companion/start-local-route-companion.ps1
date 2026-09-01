[CmdletBinding()]
param(
    [ValidateSet('127.0.0.1')]
    [string]$HostAddress = '127.0.0.1',

    [ValidateRange(0, 65535)]
    [int]$Port = 43127,

    [string]$AdapterModule
)

$ErrorActionPreference = 'Stop'

if ($HostAddress -cne '127.0.0.1') {
    throw 'Local route companion must bind to 127.0.0.1.'
}

$cliPath = Join-Path $PSScriptRoot 'cli.mjs'
$nodeArguments = @($cliPath, 'serve', '--host', '127.0.0.1', '--port', $Port)
if ($AdapterModule) {
    if ($AdapterModule.StartsWith('\\') -or $AdapterModule -notmatch '^[A-Za-z]:[\\/]') {
        throw 'AdapterModule must be a caller-trusted local absolute drive path; UNC and device paths are forbidden.'
    }
    $resolvedAdapterModule = (Resolve-Path -LiteralPath $AdapterModule).Path
    if ($resolvedAdapterModule -notmatch '^[A-Za-z]:\\') {
        throw 'AdapterModule must resolve to a local Windows drive path.'
    }
    $nodeArguments += @('--adapter-module', $resolvedAdapterModule)
}
& node @nodeArguments
exit $LASTEXITCODE
