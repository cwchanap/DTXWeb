enum EventType {
	SCENE_READY = 'current-scene-ready',
	EDITOR_LOADED = 'editor-loaded',
	MEASURE_UPDATE = 'measure-update',
	MEASURE_GOTO = 'measure-goto',
	NOTE_IMPORT = 'note-import',
	START_PREVIEW = 'start-preview',
	RESUME_PREVIEW = 'resume-preview',
	STOP_PREVIEW = 'stop-preview',
	GRID_SPACING_UPDATE = 'grid-spacing-update',
	CELL_HEIGHT_UPDATE = 'cell-height-update'
}

export default EventType;
