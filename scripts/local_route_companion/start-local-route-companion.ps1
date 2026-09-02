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
if ($PSBoundParameters.ContainsKey('AdapterModule')) {
    throw 'External AdapterModule loading is disabled; use a reviewed in-process companion.'
}
& node @nodeArguments
exit $LASTEXITCODE
