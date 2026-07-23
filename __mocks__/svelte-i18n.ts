export const _ = {
	subscribe: (cb: (fn: (key: string) => string) => void) => {
		cb((key: string) => key);
		return () => {};
	}
};

export const locale = {
	subscribe: (cb: (value: string) => void) => {
		cb('en');
		return () => {};
	}
};
