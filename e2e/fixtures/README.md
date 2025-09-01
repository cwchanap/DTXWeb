# MIDI Test Fixtures

This directory contains TypeScript-generated MIDI test fixtures for the Playwright E2E tests. The fixtures are created using workspace-level tools and TypeScript for type safety and maintainability.

## Files

### Generated MIDI Files

- **`test-sample.mid`** - Simple melody with 4 notes (C4, E4, G4, C5) at 120 BPM
- **`empty-sample.mid`** - Valid MIDI file with no notes, just metadata
- **`multi-track-sample.mid`** - Multi-track MIDI (Format 1) with melody and bass tracks
- **`invalid-file.txt`** - Text file for testing error handling

### Scripts

- **`create-test-midi.ts`** - TypeScript script that generates all MIDI fixtures
- **`verify-fixtures.ts`** - Validation script to ensure fixtures are valid MIDI files

## Usage

### Generate Fixtures

```bash
npm run fixtures:generate
```

### Verify Fixtures

```bash
npm run fixtures:verify
```

### Run E2E Tests

```bash
npm run e2e
npm run e2e:ui  # Interactive UI mode
```

## Technical Details

### MIDI File Structure

The fixtures are generated with proper MIDI file structure:

- Header chunk (`MThd`) with format, track count, and timing division
- Track chunks (`MTrk`) with MIDI events and proper delta times
- Tempo meta events (120 BPM)
- Track name meta events
- Note on/off events with proper timing
- End of track meta events

### TypeScript Implementation

The `MidiFileBuilder` class provides:

- Type-safe MIDI file construction
- Proper variable-length quantity encoding for delta times
- Support for multi-track files (Format 0 and 1)
- Note timing calculations with tick-based precision
- Comprehensive error handling

### File Specifications

- **Format 0**: Single track with all events
- **Format 1**: Multiple tracks with separate channels/instruments
- **Timing**: 480 ticks per quarter note
- **Tempo**: 120 BPM (default)
- **Notes**: Standard MIDI note numbers (C4 = 60)

## Validation

All fixtures are automatically validated for:

- Correct MIDI header signature (`MThd`)
- Proper header length and format
- Valid track count and structure
- Correct track chunk signatures (`MTrk`)
- Matching declared vs actual track counts

This ensures reliable test data for the MIDI preview functionality.
