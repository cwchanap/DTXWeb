property safeValues : {}
property nodeCount : 0
property candidates : {}
property destinationName : ""
property stageName : "initializing"

on emitDiagnostic(messageText)
	log ("AX_DIAGNOSTIC " & messageText)
end emitDiagnostic

on addPathValues(pathText, delimiterText)
	set previousDelimiters to AppleScript's text item delimiters
	set AppleScript's text item delimiters to delimiterText
	repeat with part in text items of pathText
		if (contents of part) is not "" then set end of safeValues to contents of part
	end repeat
	set AppleScript's text item delimiters to previousDelimiters
	set end of safeValues to pathText
end addPathValues

on preparePath(pathText)
	my addPathValues(pathText, "/")
	set end of safeValues to "file://" & pathText
	try
		set aliasText to (POSIX file pathText as alias) as text
		my addPathValues(aliasText, ":")
		my emitDiagnostic("target HFS alias=" & aliasText)
	on error errorText number errorNumber
		my emitDiagnostic("target HFS alias unavailable, error=" & errorNumber)
	end try
end preparePath

on safeText(attributeValue)
	if attributeValue is missing value then return "<missing>"
	if class of attributeValue is not text then return "<non-text>"
	if safeValues contains attributeValue then return attributeValue
	return "<redacted>"
end safeText

on safeAttribute(elementRef, attributeName)
	try
		tell application "System Events" to set attributeValue to value of attribute attributeName of elementRef
		return my safeText(attributeValue)
	on error errorText number errorNumber
		return "<unavailable:" & errorNumber & ">"
	end try
end safeAttribute

on safeName(elementRef)
	try
		tell application "System Events" to set elementName to name of elementRef
		return my safeText(elementName)
	on error errorText number errorNumber
		return "<unavailable:" & errorNumber & ">"
	end try
end safeName

on elementRole(elementRef)
	try
		tell application "System Events" to return value of attribute "AXRole" of elementRef
	on error
		return "<unavailable>"
	end try
end elementRole

on describeElement(elementRef, elementPath, detailed)
	set roleText to my elementRole(elementRef)
	set lineText to elementPath & " role=" & roleText
	if detailed then
		set lineText to lineText & " name=" & (my safeName(elementRef))
		repeat with attributeName in {"AXSubrole", "AXRoleDescription", "AXDescription", "AXTitle", "AXValue", "AXIdentifier", "AXURL"}
			set lineText to lineText & " " & attributeName & "=" & (my safeAttribute(elementRef, contents of attributeName))
		end repeat
	end if
	my emitDiagnostic(lineText)
end describeElement

on walkElement(elementRef, elementPath, depth, detailed, collectCandidates)
	if nodeCount ≥ 160 then return
	set nodeCount to nodeCount + 1
	set roleText to my elementRole(elementRef)
	set inspectAttributes to false
	if detailed and (roleText is in {"AXWindow", "AXSheet", "AXGroup", "AXToolbar", "AXPopUpButton", "AXButton"}) then set inspectAttributes to true
	my describeElement(elementRef, elementPath, inspectAttributes)
	if roleText is "AXPopUpButton" and detailed and collectCandidates then
		try
			tell application "System Events" to set popupValue to value of attribute "AXValue" of elementRef
			if popupValue is destinationName then set end of candidates to elementRef
		end try
	end if
	if roleText is in {"AXScrollArea", "AXTable", "AXOutline", "AXBrowser", "AXList", "AXWebArea", "AXColumn", "AXRow"} then
		my emitDiagnostic(elementPath & " children omitted for privacy")
		return
	end if
	if depth ≥ 8 then
		my emitDiagnostic(elementPath & " depth limit")
		return
	end if
	try
		tell application "System Events" to set childElements to UI elements of elementRef
		set childIndex to 0
		repeat with childRef in childElements
			set childIndex to childIndex + 1
			my walkElement(contents of childRef, elementPath & "/" & childIndex, depth + 1, detailed, collectCandidates)
			if nodeCount ≥ 160 then
				my emitDiagnostic("tree node limit reached")
				exit repeat
			end if
		end repeat
	on error errorText number errorNumber
		my emitDiagnostic(elementPath & " children unavailable, error=" & errorNumber)
	end try
end walkElement

on dumpPanel(detailed)
	set nodeCount to 0
	set candidates to {}
	tell application "System Events" to tell process "dtx-desktop"
		set ownedWindows to every window
		my emitDiagnostic("owned process window count=" & (count of ownedWindows))
		set windowIndex to 0
		repeat with windowRef in ownedWindows
			set windowIndex to windowIndex + 1
			set nodeCount to 0
			my walkElement(contents of windowRef, "window[" & windowIndex & "]", 0, true, false)
		end repeat
		if not (exists window "Drumery") then
			my emitDiagnostic("owned Drumery window unavailable")
			return
		end if
		set ownedWindow to window "Drumery"
		my describeElement(ownedWindow, "window Drumery", detailed)
		set sheetCount to count of sheets of ownedWindow
		my emitDiagnostic("owned window sheet count=" & sheetCount)
		if sheetCount is 0 then return
		set panelRef to sheet 1 of ownedWindow
	end tell
	set nodeCount to 0
	my walkElement(panelRef, "sheet[1]", 0, detailed, true)
end dumpPanel

on requireUniqueProcess()
	tell application "System Events"
		set appProcesses to every process whose name is "dtx-desktop"
		if (count of appProcesses) is not 1 then error "expected exactly one owned dtx-desktop process"
	end tell
end requireUniqueProcess

on cancelPanel()
	my requireUniqueProcess()
	tell application "System Events" to tell process "dtx-desktop"
		repeat with attempt from 1 to 4
			if not (exists window "Drumery") then
				error "owned window unavailable during cleanup"
			end if
			if not (exists sheet 1 of window "Drumery") then
				if (count of windows) is not 1 then error "cannot confirm closure with other app windows present"
				my emitDiagnostic("cleanup: owned sheet closed")
				return
			end if
			set frontmost to true
			if not frontmost then error "owned process did not take focus"
			key code 53
			delay 0.5
		end repeat
		if exists sheet 1 of window "Drumery" then error "owned sheet still open after cancellation"
		if (count of windows) is not 1 then error "cannot confirm closure with other app windows present"
		my emitDiagnostic("cleanup: owned sheet closed")
	end tell
end cancelPanel

on capturePath(pathText)
	set previousDelimiters to AppleScript's text item delimiters
	set AppleScript's text item delimiters to "/"
	set destinationName to last text item of pathText
	set AppleScript's text item delimiters to previousDelimiters
	set stageName to "Go to Folder " & pathText
	my emitDiagnostic("stage=" & stageName)
	tell application "System Events" to tell process "dtx-desktop"
		if not (exists sheet 1 of window "Drumery") then error "owned sheet missing"
		set frontmost to true
		if not frontmost then error "owned process did not take focus"
		keystroke "g" using {command down, shift down}
		set fieldDeadline to (current date) + 10
		repeat
			if exists text field 1 of sheet 1 of sheet 1 of window "Drumery" then exit repeat
			if (current date) > fieldDeadline then error "Go to Folder field missing"
			delay 0.25
		end repeat
		set gotoField to text field 1 of sheet 1 of sheet 1 of window "Drumery"
		set focused of gotoField to true
		delay 0.25
		if not (focused of gotoField) then error "Go to Folder field did not take focus"
		keystroke "a" using command down
		keystroke pathText
		if value of gotoField is not pathText then error "Go to Folder field mismatch"
		key code 36
		set dismissDeadline to (current date) + 10
		repeat
			if not (exists sheet 1 of sheet 1 of window "Drumery") then exit repeat
			if (current date) > dismissDeadline then error "Go to Folder sheet did not close"
			delay 0.25
		end repeat
	end tell
	delay 1
	set stageName to "panel tree after Go to Folder " & pathText
	my emitDiagnostic("stage=" & stageName)
	my dumpPanel(true)
	my emitDiagnostic("matching location-value popup count=" & (count of candidates))
	if (count of candidates) is not 1 then error "location popup not unique"
	set locationPopup to item 1 of candidates
	set stageName to "location menu " & pathText
	my emitDiagnostic("stage=" & stageName)
	tell application "System Events"
		click locationPopup
		delay 0.5
		if not (exists menu 1 of locationPopup) then error "location menu unavailable"
		set menuRef to menu 1 of locationPopup
		set menuElements to UI elements of menuRef
	end tell
	my describeElement(menuRef, "location menu", true)
	my emitDiagnostic("location menu child count=" & (count of menuElements))
	set menuIndex to 0
	repeat with menuElement in menuElements
		set menuIndex to menuIndex + 1
		my describeElement(contents of menuElement, "location menu[" & menuIndex & "]", true)
	end repeat
	tell application "System Events" to tell process "dtx-desktop"
		if not frontmost then error "owned process lost focus before closing menu"
		key code 53
	end tell
	delay 0.25
end capturePath

on run argv
	set runMode to item 1 of argv
	if runMode is "cleanup" then
		with timeout of 4 seconds
			my cancelPanel()
		end timeout
		return
	end if
	if runMode is not "capture" or (count of argv) is not 3 then error "invalid diagnostic arguments"
	with timeout of 4 seconds
		my requireUniqueProcess()
	end timeout
	set safeValues to {"Drumery", "Where", "Where:", "Cancel", "Open", "Choose", "New Folder", "window", "sheet", "group", "toolbar", "button", "pop up button", "menu", "menu item"}
	my preparePath(item 2 of argv)
	my preparePath(item 3 of argv)
	my emitDiagnostic("AX_DIAGNOSTIC_READY")
	set failed to false
	with timeout of 4 seconds
		try
			set stageName to "waiting for owned sheet"
			tell application "System Events" to tell process "dtx-desktop"
				set appearDeadline to (current date) + 20
				repeat
					if exists sheet 1 of window "Drumery" then exit repeat
					if (current date) > appearDeadline then error "owned sheet did not appear"
					delay 0.25
				end repeat
			end tell
			my capturePath(item 2 of argv)
			my capturePath(item 3 of argv)
		on error errorText number errorNumber
			set failed to true
			my emitDiagnostic("failure stage=" & stageName & " error=" & errorNumber)
			try
				my emitDiagnostic("best available owned window tree and sheet roles")
				my dumpPanel(false)
			on error errorText2 number errorNumber2
				my emitDiagnostic("tree unavailable, error=" & errorNumber2)
			end try
		end try
		try
			my cancelPanel()
		on error errorText number errorNumber
			set failed to true
			my emitDiagnostic("cleanup failed, error=" & errorNumber)
		end try
	end timeout
	if failed then error "temporary AX diagnostic failed"
	my emitDiagnostic("capture complete; no native acceptance asserted")
end run
