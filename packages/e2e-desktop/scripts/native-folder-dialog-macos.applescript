on run argv
	set dialogAction to item 1 of argv
	set targetDirectory to item 2 of argv

	if dialogAction is not "select" and dialogAction is not "cancel" then
		error "unsupported action: " & dialogAction
	end if

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
					if exists sheet 1 of sheet 1 of window "Drumery" then exit repeat
					if exists text field 1 of sheet 1 of window "Drumery" then exit repeat
					if (current date) > fieldDeadline then error "Go to Folder field not found after 10s"
					delay 0.25
				end repeat

				delay 0.5
				keystroke targetDirectory
				key code 36

				set navigateDeadline to (current date) + 10
				repeat
					if (not (exists sheet 1 of sheet 1 of window "Drumery")) and (not (exists text field 1 of sheet 1 of window "Drumery")) then exit repeat
					if (current date) > navigateDeadline then error "Go to Folder field did not close after 10s"
					delay 0.25
				end repeat

				delay 0.5
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
