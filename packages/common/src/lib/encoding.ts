// Encoding module re-exports.
// Separated from the main barrel so server-side consumers (dtx-api) can import
// text decoding helpers without pulling `svelte/store` and other browser/UI
// modules from `@dtx/common` — dtx-api does not declare svelte as a dependency.
export {
	decodeFileWithEncodingDetection,
	decodeFileWithSpecificEncoding,
	decodeArrayBufferWithBomDetection
} from './chart/encoding-utils';
