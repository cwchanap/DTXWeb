export const _ = {
	subscribe: (cb: (fn: (key: string) => string) => void) => {
		cb((key: string) => key);
		return () => {};
	}
};
