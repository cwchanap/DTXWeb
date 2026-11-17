on emitStage(stageName)
	log ("NATIVE_FOLDER_DIALOG stage=" & stageName)
end emitStage

on run argv
	set dialogAction to item 1 of argv
	set targetDirectory to item 2 of argv

	my emitStage("resolve target")
	if dialogAction is not "select" and dialogAction is not "cancel" then
		error "unsupported action: " & dialogAction
	end if

	if targetDirectory ends with "/" then set targetDirectory to text 1 thru -2 of targetDirectory
	set previousDelimiters to AppleScript's text item delimiters
	set AppleScript's text item delimiters to "/"
	set pathParts to {}
	repeat with pathPart in (text items of targetDirectory)
		if (contents of pathPart) is not "" then set end of pathParts to contents of pathPart
	end repeat
	set AppleScript's text item delimiters to previousDelimiters
	if (count of pathParts) is 0 then error "target directory has no name: " & targetDirectory
	set destinationName to last item of pathParts
	if dialogAction is "select" then
		if targetDirectory does not start with "/" then error "target directory is not absolute: " & targetDirectory
		try
			set targetHFSPath to ((POSIX file targetDirectory) as alias) as text
		on error errorMessage
			error "cannot resolve target directory '" & targetDirectory & "': " & errorMessage
		end try
		if targetHFSPath does not end with ":" then error "target directory has an invalid HFS path: " & targetDirectory
		set previousDelimiters to AppleScript's text item delimiters
		set AppleScript's text item delimiters to ":"
		set pathParts to text items of text 1 thru -2 of targetHFSPath
		set AppleScript's text item delimiters to previousDelimiters
		repeat with pathPart in pathParts
			if (contents of pathPart) is "" then error "target directory has an invalid HFS path: " & targetDirectory
		end repeat
	end if

	my driveDialog(dialogAction, targetDirectory, destinationName, pathParts)
end run

on driveDialog(dialogAction, targetDirectory, destinationName, pathParts)
	with timeout of 4 seconds
		tell application "System Events"
			if dialogAction is "select" then
				my emitStage("read volumes")
				set diskNames to name of every disk
				set volumeMatches to 0
				ignoring case and diacriticals
					repeat with diskName in diskNames
						if (contents of diskName) is (item 1 of pathParts) then set volumeMatches to volumeMatches + 1
					end repeat
				end ignoring
				if volumeMatches is not 1 then error "target volume '" & item 1 of pathParts & "' is missing or ambiguous"
			end if
			my emitStage("find app")
			if not (exists process "dtx-desktop") then error "dtx-desktop process not found"
			tell process "dtx-desktop"
				my emitStage("wait for dialog")
				set appearDeadline to (current date) + 20
				repeat
					if exists sheet 1 of window "Drumery" then exit repeat
					if (current date) > appearDeadline then error "dialog not found after 20s"
					delay 0.25
				end repeat

				my emitStage("focus dialog")
				set frontmost to true
				delay 0.5
				if not frontmost then error "dtx-desktop did not take focus"

				if dialogAction is "cancel" then
					my emitStage("cancel dialog")
					key code 53
				else
					my emitStage("open Go to Folder")
					keystroke "g" using {command down, shift down}

					my emitStage("wait for Go to Folder field")
					set fieldDeadline to (current date) + 10
					repeat
						if exists text field 1 of sheet 1 of sheet 1 of window "Drumery" then exit repeat
						if (current date) > fieldDeadline then error "Go to Folder text field not found after 10s"
						delay 0.25
					end repeat

					my emitStage("type target")
					set gotoField to text field 1 of sheet 1 of sheet 1 of window "Drumery"
					set focused of gotoField to true
					delay 0.25
					if not (focused of gotoField) then error "Go to Folder text field did not take focus"
					if not frontmost then error "dtx-desktop lost focus before typing"
					keystroke targetDirectory
					set fieldValueDeadline to (current date) + 3
					repeat
						if value of gotoField is targetDirectory then exit repeat
						if (current date) > fieldValueDeadline then error "Go to Folder field did not receive the target path"
						delay 0.1
					end repeat
					my emitStage("navigate")
					if not frontmost then error "dtx-desktop lost focus before navigation"
					key code 36

					my emitStage("wait for Go to Folder to close")
					set dismissDeadline to (current date) + 10
					repeat
						if not (exists sheet 1 of sheet 1 of window "Drumery") then exit repeat
						if (current date) > dismissDeadline then error "Go to Folder sheet did not close after 10s"
						delay 0.25
					end repeat

					set navigateDeadline to (current date) + 10
					set lastPathSeen to ""
					repeat
						set locationPopup to missing value
						set popupCount to 0
						my emitStage("read sheet children")
						set panelRef to a reference to sheet 1 of window "Drumery"
						set sheetElements to UI elements of panelRef
						if (count of sheetElements) is greater than 1 then error "open panel has ambiguous root elements"
						if (count of sheetElements) is 1 then
							set splitRef to item 1 of sheetElements
							my emitStage("inspect split group")
							if value of attribute "AXRole" of splitRef is not "AXSplitGroup" then error "open panel has unexpected root element"
							my emitStage("read split children")
							set panelElements to UI elements of splitRef
							if (count of panelElements) is greater than 64 then error "open panel has too many split group children"
							my emitStage("inspect popup children")
							repeat with panelElement in panelElements
								if (current date) > navigateDeadline then error "open panel location probe exceeded 10s"
								set elementRef to contents of panelElement
								if (value of attribute "AXRole" of elementRef is "AXPopUpButton") and (name of elementRef is "Where:") then
									set locationPopup to elementRef
									set popupCount to popupCount + 1
								end if
							end repeat
						end if
						if popupCount is greater than 1 then error "multiple Where location popups in open panel"
						if locationPopup is not missing value then
							set ancestorNames to {}
							my emitStage("read popup value")
							if value of attribute "AXValue" of locationPopup is destinationName then
								my emitStage("open location menu")
								-- System Events may not reply until the popup menu closes;
								-- ignoring the response avoids an errAETimeout (-1712).
								ignoring application responses
									click locationPopup
								end ignoring
								set menuDeadline to (current date) + 3
								repeat
									if exists menu 1 of locationPopup then exit repeat
									if (current date) > menuDeadline then exit repeat
									delay 0.1
								end repeat
								if exists menu 1 of locationPopup then
									my emitStage("read location menu children")
									set menuRef to a reference to menu 1 of locationPopup
									set menuElements to UI elements of menuRef
									if (count of menuElements) is greater than 64 then error "open panel location menu has too many items"
									my emitStage("inspect location menu items")
									repeat with menuElement in menuElements
										if (current date) > navigateDeadline then error "open panel location probe exceeded 10s"
										set menuElementRef to contents of menuElement
										if value of attribute "AXRole" of menuElementRef is not "AXMenuItem" then error "open panel location menu has an invalid item"
										try
											set menuName to name of menuElementRef
										on error
											-- Separators and other nameless items carry no match value.
											set menuName to missing value
										end try
										set end of ancestorNames to menuName
									end repeat
									my emitStage("close location menu")
									if not frontmost then error "dtx-desktop lost focus before closing location menu"
									key code 53
									if not (exists sheet 1 of window "Drumery") then error "open panel closed before location confirmation"
								end if
								my emitStage("verify location")
								set previousDelimiters to AppleScript's text item delimiters
								set AppleScript's text item delimiters to ":"
								set pathNames to {}
								repeat with ancestorName in ancestorNames
									if (class of ancestorName) is text then set end of pathNames to contents of ancestorName
								end repeat
								set lastPathSeen to (reverse of pathNames) as text
								set AppleScript's text item delimiters to previousDelimiters
								set pathCount to count of pathParts
								set menuItemCount to count of ancestorNames
								-- The menu may carry extras beyond the path itself (a
								-- trailing "Computer" entry, Favorites, Recent Places,
								-- separators): accept any contiguous run of items
								-- matching the expected ancestor chain.
								set pathMatches to false
								if menuItemCount is greater than or equal to pathCount then
									considering case
										repeat with startIndex from 1 to (menuItemCount - pathCount + 1)
											set runMatches to true
											repeat with i from 1 to pathCount
												if item (startIndex + i - 1) of ancestorNames is not item (pathCount - i + 1) of pathParts then
													set runMatches to false
													exit repeat
												end if
											end repeat
											if runMatches then
												set pathMatches to true
												exit repeat
											end if
										end repeat
									end considering
								end if
								if pathMatches then exit repeat
							end if
						end if
						if (current date) > navigateDeadline then
							if lastPathSeen is not "" then
								error "open panel location '" & lastPathSeen & "' did not match '" & targetDirectory & "' after 10s"
							else
								error "open panel Where location unavailable for '" & targetDirectory & "' after 10s"
							end if
						end if
						delay 0.25
					end repeat

					my emitStage("confirm selection")
					if not frontmost then error "dtx-desktop lost focus before selection"
					if not (exists sheet 1 of window "Drumery") then error "open panel closed before selection"
					key code 36
				end if

				my emitStage("wait for dialog to close")
				set closeDeadline to (current date) + 10
				repeat
					if not (exists sheet 1 of window "Drumery") then exit repeat
					if (current date) > closeDeadline then error "dialog still open after 10s"
					delay 0.25
				end repeat
			end tell
		end tell
	end timeout
end driveDialog
