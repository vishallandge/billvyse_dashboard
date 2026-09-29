' Starts the BillVyse Print Bridge with no window at all. Used by "Start with Windows.bat"
' (and fine to double-click). If it is already running, the second copy exits by itself.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
If fso.FileExists(dir & "\billvyse-print-bridge.exe") Then
  sh.Run """" & dir & "\billvyse-print-bridge.exe""", 0, False
ElseIf fso.FileExists(dir & "\node.exe") Then
  sh.Run """" & dir & "\node.exe"" """ & dir & "\bridge.js""", 0, False
Else
  sh.Run "node """ & dir & "\bridge.js""", 0, False
End If
