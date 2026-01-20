/*
Sveltekit renders the page in the server this causes some errors with native browser objects like window, document, HTMLVideoElement etc.
This line of code is to tell sveltekit to not render the page in the server and only in the client.
*/
export const ssr = false;

export const load = async () => {
	const globalTarget = globalThis as typeof globalThis & {
		__xaDecoderReady?: boolean;
		__xaDecoderError?: string;
	};

	globalTarget.__xaDecoderReady = false;
	globalTarget.__xaDecoderError = undefined;

	void import('xa_decoder')
		.then(({ default: init }) => init({}))
		.then(() => {
			globalTarget.__xaDecoderReady = true;
		})
		.catch((error) => {
			globalTarget.__xaDecoderError = error instanceof Error ? error.message : String(error);
			console.warn('XA decoder init failed:', error);
		});
};
