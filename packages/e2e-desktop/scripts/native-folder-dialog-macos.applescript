on run argv
	set dialogAction to item 1 of argv
	set targetDirectory to item 2 of argv

	if dialogAction is not "select" and dialogAction is not "cancel" then
		error "unsupported action: " & dialogAction
	end if

	if targetDirectory ends with "/" then set targetDirectory to text 1 thru -2 of targetDirectory
	set previousDelimiters to AppleScript's text item delimiters
	set AppleScript's text item delimiters to "/"
	set destinationName to last text item of targetDirectory
	set AppleScript's text item delimiters to previousDelimiters
	if destinationName is "" then error "target directory has no name: " & targetDirectory

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

				set preSelected to false
				repeat with preElement in (entire contents of sheet 1 of window "Drumery")
					try
						if selected of preElement and name of preElement is destinationName then set preSelected to true
					end try
					if preSelected then exit repeat
				end repeat
				if preSelected then error "a selected item named '" & destinationName & "' already exists before navigation"

				key code 36

				set dismissDeadline to (current date) + 10
				repeat
					if not (exists sheet 1 of sheet 1 of window "Drumery") then exit repeat
					if (current date) > dismissDeadline then error "Go to Folder sheet did not close after 10s"
					delay 0.25
				end repeat

				set navigateDeadline to (current date) + 10
				repeat
					set destinationSelected to false
					repeat with panelElement in (entire contents of sheet 1 of window "Drumery")
						try
							if selected of panelElement and name of panelElement is destinationName then set destinationSelected to true
						end try
						if destinationSelected then exit repeat
					end repeat
					if destinationSelected then exit repeat
					if (current date) > navigateDeadline then error "open panel did not select '" & destinationName & "' after 10s"
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
