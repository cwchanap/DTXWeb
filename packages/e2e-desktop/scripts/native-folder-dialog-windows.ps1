param(
	[Parameter(Mandatory = $true, Position = 0)]
	[string]$Action,
	[Parameter(Mandatory = $true, Position = 1)]
	[string]$Directory
)

$ErrorActionPreference = 'Stop'

if ($Action -ne 'select' -and $Action -ne 'cancel') {
	[Console]::Error.WriteLine("unsupported action: $Action")
	exit 1
}

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

function Get-AppDialog {
	$processes = Get-Process -Name 'dtx-desktop' -ErrorAction SilentlyContinue
	if (-not $processes) { return $null }
	$pids = @($processes | ForEach-Object { $_.Id })
	$classCondition = New-Object System.Windows.Automation.PropertyCondition(
		[System.Windows.Automation.AutomationElement]::ClassNameProperty, '#32770')
	$dialogs = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
		[System.Windows.Automation.TreeScope]::Children, $classCondition)
	foreach ($dialog in $dialogs) {
		if ($pids -contains $dialog.Current.ProcessId) { return $dialog }
	}
	return $null
}

function Get-DialogControl {
	param(
		[System.Windows.Automation.AutomationElement]$Root,
		[string]$AutomationId
	)
	$condition = New-Object System.Windows.Automation.PropertyCondition(
		[System.Windows.Automation.AutomationElement]::AutomationIdProperty, $AutomationId)
	return $Root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
}

$appearDeadline = (Get-Date).AddSeconds(20)
$dialog = $null
while ((Get-Date) -lt $appearDeadline) {
	$dialog = Get-AppDialog
	if ($dialog) { break }
	Start-Sleep -Milliseconds 250
}
if (-not $dialog) {
	[Console]::Error.WriteLine('dialog not found after 20s')
	exit 1
}

$fileNameEdit = Get-DialogControl -Root $dialog -AutomationId '1152'
$confirmButton = Get-DialogControl -Root $dialog -AutomationId '1'
$cancelButton = Get-DialogControl -Root $dialog -AutomationId '2'
if (-not $fileNameEdit -or -not $confirmButton -or -not $cancelButton) {
	[Console]::Error.WriteLine('dialog found but expected controls 1152/1/2 are missing')
	exit 1
}

try {
	if ($Action -eq 'select') {
		$fileNameEdit.GetCurrentPattern(
			[System.Windows.Automation.ValuePattern]::Pattern).SetValue($Directory)
		$confirmButton.GetCurrentPattern(
			[System.Windows.Automation.InvokePattern]::Pattern).Invoke()
	} else {
		$cancelButton.GetCurrentPattern(
			[System.Windows.Automation.InvokePattern]::Pattern).Invoke()
	}
} catch {
	[Console]::Error.WriteLine("dialog action '$Action' failed: $_")
	exit 1
}

$closeDeadline = (Get-Date).AddSeconds(10)
while ((Get-Date) -lt $closeDeadline) {
	if (-not (Get-AppDialog)) { exit 0 }
	Start-Sleep -Milliseconds 250
}
[Console]::Error.WriteLine('dialog still open after 10s')
exit 1
