type Meta = Record<string, unknown>;

// Winston's Error replacer: JSON.stringify alone serializes Error to {}.
// name/cause/code and other own properties are lost by default — cause is a
// non-enumerable own property on Error, so it is restored explicitly.
const serializeError = (error: Error): Record<string, unknown> => {
	const serialized: Record<string, unknown> = {
		...error,
		name: error.name,
		message: error.message,
		stack: error.stack
	};
	if (error.cause !== undefined) {
		serialized.cause = error.cause instanceof Error ? serializeError(error.cause) : error.cause;
	}
	return serialized;
};

const errorReplacer = (_: string, value: unknown): unknown =>
	value instanceof Error ? serializeError(value) : value;

const format = (level: string, msg: string, meta?: Meta): string =>
	JSON.stringify({ ...(meta ?? {}), ts: new Date().toISOString(), level, msg }, errorReplacer);

export const workerLogger = {
	info: (msg: string, meta?: Meta) => console.log(format('info', msg, meta)),
	warn: (msg: string, meta?: Meta) => console.warn(format('warn', msg, meta)),
	error: (msg: string, meta?: Meta) => console.error(format('error', msg, meta)),
	debug: (msg: string, meta?: Meta) => console.debug(format('debug', msg, meta))
};

export type WorkerLogger = typeof workerLogger;
