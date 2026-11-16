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

	tell application "System Events"
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
				keystroke targetDirectory
				if value of gotoField is not targetDirectory then error "Go to Folder field did not receive the target path"
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
					repeat with panelElement in (entire contents of sheet 1 of window "Drumery")
						try
							if (role of panelElement is "AXPopUpButton") and (value of panelElement is destinationName) then
								set locationPopup to panelElement
								exit repeat
							end if
						end try
					end repeat
					if locationPopup is not missing value then
						set ancestorNames to {}
						click locationPopup
						delay 0.25
						if exists menu 1 of locationPopup then
							try
								set ancestorNames to name of menu items of menu 1 of locationPopup
							end try
							key code 53
						end if
						if class of ancestorNames is not list then set ancestorNames to {ancestorNames}
						if (count of ancestorNames) >= (count of pathParts) then
							set pathMatches to true
							repeat with i from 1 to (count of pathParts)
								if item i of ancestorNames is not item ((count of pathParts) - i + 1) of pathParts then
									set pathMatches to false
									exit repeat
								end if
							end repeat
							if pathMatches then exit repeat
							set previousDelimiters to AppleScript's text item delimiters
							set AppleScript's text item delimiters to "/"
							set lastPathSeen to (reverse of ancestorNames) as text
							set AppleScript's text item delimiters to previousDelimiters
						end if
					end if
					if (current date) > navigateDeadline then
						if lastPathSeen is not "" then
							error "open panel location '" & lastPathSeen & "' did not match '" & targetDirectory & "' after 10s"
						else
							error "open panel did not navigate to '" & targetDirectory & "' after 10s"
						end if
					end if
					delay 0.25
				end repeat

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
