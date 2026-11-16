on run argv
	set dialogAction to item 1 of argv
	set targetDirectory to item 2 of argv

	if dialogAction is not "select" and dialogAction is not "cancel" then
		error "unsupported action: " & dialogAction
	end if

	if targetDirectory ends with "/" then set targetDirectory to text 1 thru -2 of targetDirectory
	set previousDelimiters to AppleScript's text item delimiters
	set AppleScript's text item delimiters to "/"
	set pathParts to {}
	repeat with pathPart in (text items of targetDirectory)
		if pathPart is not "" then set end of pathParts to pathPart
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
			if pathPart is "" then error "target directory has an invalid HFS path: " & targetDirectory
		end repeat
	end if

	tell application "System Events"
		if dialogAction is "select" then
			set diskNames to name of every disk
			set volumeMatches to 0
			ignoring case and diacriticals
				repeat with diskName in diskNames
					if (contents of diskName) is (item 1 of pathParts) then set volumeMatches to volumeMatches + 1
				end repeat
			end ignoring
			if volumeMatches is not 1 then error "target volume '" & item 1 of pathParts & "' is missing or ambiguous"
		end if
		if not (exists process "dtx-desktop") then error "dtx-desktop process not found"
		tell process "dtx-desktop"
			set appearDeadline to (current date) + 20
			repeat
				if exists sheet 1 of window "Drumery" then exit repeat
				if (current date) > appearDeadline then error "dialog not found after 20s"
				delay 0.25
			end repeat

			set frontmost to true
			delay 0.5
			if not frontmost then error "dtx-desktop did not take focus"

			if dialogAction is "cancel" then
				key code 53
			else
				keystroke "g" using {command down, shift down}

				set fieldDeadline to (current date) + 10
				repeat
					if exists text field 1 of sheet 1 of sheet 1 of window "Drumery" then exit repeat
					if (current date) > fieldDeadline then error "Go to Folder text field not found after 10s"
					delay 0.25
				end repeat

				set gotoField to text field 1 of sheet 1 of sheet 1 of window "Drumery"
				set focused of gotoField to true
				delay 0.25
				if not (focused of gotoField) then error "Go to Folder text field did not take focus"
				if not frontmost then error "dtx-desktop lost focus before typing"
				keystroke targetDirectory
				if value of gotoField is not targetDirectory then error "Go to Folder field did not receive the target path"
				if not frontmost then error "dtx-desktop lost focus before navigation"
				key code 36

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
					repeat with panelElement in (entire contents of sheet 1 of window "Drumery")
						try
							if (role of panelElement is "AXPopUpButton") and (name of panelElement is "Where:") then
								set locationPopup to contents of panelElement
								set popupCount to popupCount + 1
							end if
						end try
					end repeat
					if popupCount is greater than 1 then error "multiple Where location popups in open panel"
					if locationPopup is not missing value then
						set ancestorNames to {}
						if value of locationPopup is destinationName then
							click locationPopup
							delay 0.25
							if exists menu 1 of locationPopup then
								try
									set ancestorNames to name of menu items of menu 1 of locationPopup
								end try
								if not frontmost then error "dtx-desktop lost focus before closing location menu"
								key code 53
								if not (exists sheet 1 of window "Drumery") then error "open panel closed before location confirmation"
							end if
							if class of ancestorNames is not list then set ancestorNames to {ancestorNames}
							set previousDelimiters to AppleScript's text item delimiters
							set AppleScript's text item delimiters to ":"
							set lastPathSeen to (reverse of ancestorNames) as text
							set AppleScript's text item delimiters to previousDelimiters
							if (count of ancestorNames) is (count of pathParts) + 1 then
								if (class of (last item of ancestorNames)) is not text then error "open panel location menu has an invalid trailing item"
								if (last item of ancestorNames) is "" then error "open panel location menu has an empty trailing item"
								set pathMatches to true
								considering case
									repeat with i from 1 to (count of pathParts)
										if item i of ancestorNames is not item ((count of pathParts) - i + 1) of pathParts then
											set pathMatches to false
											exit repeat
										end if
									end repeat
								end considering
								if pathMatches then exit repeat
							end if
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

				if not frontmost then error "dtx-desktop lost focus before selection"
				if not (exists sheet 1 of window "Drumery") then error "open panel closed before selection"
				key code 36
			end if

			set closeDeadline to (current date) + 10
			repeat
				if not (exists sheet 1 of window "Drumery") then exit repeat
				if (current date) > closeDeadline then error "dialog still open after 10s"
				delay 0.25
			end repeat
		end tell
	end tell
end run
