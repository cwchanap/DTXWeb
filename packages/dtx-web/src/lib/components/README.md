# Component Tests

This directory contains tests for the Svelte components in the DTX Web application.

## ChartDetail Component Tests

The `ChartDetail.test.js` file contains tests for the `ChartDetail.svelte` component. These tests focus on the business logic of the component rather than DOM interactions, which is compatible with Svelte 5's approach to testing.

### Running the Tests

Due to issues with the `@dtx/common` package in the test environment, the tests are also available in a standalone test runner:

```bash
cd /workspace/DTXWeb/packages/dtx-web
node simple-test-runner.js
```

### Test Coverage

The tests cover the following aspects of the ChartDetail component:

1. **Initial State**: Tests that the component initializes with the correct state when a simfile is provided.
2. **Default State**: Tests that the component initializes with default values when no simfile is provided.
3. **Empty DTX Files**: Tests that the component handles simfiles with empty dtx_files arrays.
4. **Event Dispatching**: Tests that the onSave event is dispatched with the correct parameters.
5. **State Updates**: Tests that the component's state updates correctly when values change.
6. **Switch Component**: Tests that the Switch component's checked state changes correctly.
7. **DTX Files Processing**: Tests that the component correctly processes dtx_files from the simfile.
8. **URL Construction**: Tests that the component constructs the correct editor link URL.

### Test Approach

The tests use a "logic-only" approach that focuses on testing the component's business logic rather than DOM interactions. This approach is compatible with Svelte 5's restrictions on certain lifecycle methods during testing.

Instead of rendering the component and interacting with the DOM, the tests simulate the component's state and behavior by creating variables and functions that mimic the component's internal state and methods.
