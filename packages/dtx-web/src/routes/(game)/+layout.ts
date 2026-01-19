/*
Sveltekit renders the page in the server this causes some errors with native browser objects like window, document, HTMLVideoElement etc.
This line of code is to tell sveltekit to not render the page in the server and only in the client.
*/
export const ssr = false;

export const load = async () => {
	void import('xa_decoder')
		.then(({ default: init }) => init({}))
		.catch((error) => {
			console.warn('XA decoder init failed:', error);
		});
};
