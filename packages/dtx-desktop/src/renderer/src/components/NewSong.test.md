# NewSong Component Unit Tests

This file contains comprehensive unit tests for the NewSong component in the DTX Desktop application.

## Test Coverage

The test suite covers the following areas:

### 1. Name Sanitization Function
- **Empty/null input handling**: Ensures the function gracefully handles empty, null, or undefined inputs
- **Path traversal prevention**: Tests removal of dangerous sequences like `../` and `..\\`
- **Path separator removal**: Verifies that forward and backward slashes are removed from names
- **Invalid character filtering**: Tests removal of characters that are invalid in filenames (`<>:"|?*` and control characters)
- **Leading/trailing cleanup**: Ensures dots and spaces are removed from the beginning and end of names
- **Windows reserved names**: Tests handling of reserved Windows filenames (CON, PRN, AUX, etc.)
- **Empty result handling**: Verifies that names that become empty after sanitization default to "untitled"
- **Length limiting**: Tests that names are truncated to 200 characters to prevent filesystem issues
- **Normal name preservation**: Ensures valid names pass through unchanged
- **Mixed character handling**: Tests complex scenarios with both dangerous and safe characters

### 2. IPC Integration Tests
- **path-exists calls**: Verifies correct parameters are passed when checking if folders exist
- **create-song calls**: Tests song creation with and without templates
- **select-folder calls**: Ensures folder selection dialog is properly invoked
- **load-tree-structure calls**: Tests workspace tree refresh after song creation

### 3. Error Handling Logic
- **IPC error handling**: Tests graceful handling of IPC communication failures
- **Path existence errors**: Verifies error handling when folder existence checks fail
- **Song creation errors**: Tests error handling when song creation fails
- **Folder selection errors**: Ensures proper error handling for folder selection failures

### 4. Validation Logic
- **Required field validation**: Tests validation of song name and path requirements
- **Folder existence validation**: Verifies that existing folders are properly detected and handled
- **Complete form validation**: Tests the overall form validation logic

### 5. Song Creation Logic
- **Same folder name**: Tests creation when using the same name for both song and folder
- **Different folder name**: Tests creation with separate song and folder names
- **Name sanitization in creation**: Verifies that dangerous names are sanitized during creation
- **Template integration**: Tests song creation with and without templates

### 6. Template Logic
- **Template selection**: Tests proper handling of template selection
- **No template handling**: Verifies behavior when no template is selected
- **Auto-population**: Tests automatic song name population from template names
- **Name preservation**: Ensures existing song names aren't overwritten by template selection

### 7. Folder Existence Checking Logic
- **Parameter validation**: Tests that correct parameters are passed to existence checks
- **Existence detection**: Verifies proper detection of existing folders
- **Warning generation**: Tests generation of appropriate warning messages

## Testing Approach

### Logic-First Testing
Due to the complexity of testing Svelte 5 components with the current testing infrastructure, this test suite focuses on testing the core business logic and functions that can be extracted and tested independently. This approach provides:

1. **High confidence in critical functionality**: The most important security and validation logic is thoroughly tested
2. **Fast test execution**: Logic tests run quickly without DOM rendering overhead
3. **Clear test isolation**: Each function and piece of logic is tested in isolation
4. **Easy maintenance**: Tests are straightforward to understand and maintain

### Mock Strategy
The tests use comprehensive mocking for:
- **Electron IPC**: All IPC calls are mocked to test integration without requiring the Electron environment
- **Store subscriptions**: Workspace and template stores are mocked to test different state scenarios
- **Error conditions**: Various error scenarios are simulated to test error handling

### Test Organization
Tests are organized into logical groups that mirror the component's functionality:
- Each describe block focuses on a specific area of functionality
- Test names clearly describe the expected behavior
- Setup and teardown ensure clean test isolation

## Running the Tests

```bash
# Run all tests
npm test

# Run only NewSong tests
npm test -- NewSong.test.ts

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

## Future Enhancements

When Svelte 5 testing infrastructure matures, consider adding:
1. **Component rendering tests**: Test actual DOM output and user interactions
2. **Integration tests**: Test the complete component workflow
3. **Visual regression tests**: Ensure UI consistency
4. **Accessibility tests**: Verify component accessibility compliance

## Security Considerations

The name sanitization function is critical for security and is thoroughly tested to prevent:
- Directory traversal attacks
- Invalid filename injection
- Filesystem corruption
- Cross-platform compatibility issues

These tests ensure that user input is properly sanitized before being used in filesystem operations.