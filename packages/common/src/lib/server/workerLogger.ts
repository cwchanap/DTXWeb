type Meta = Record<string, unknown>;

const format = (level: string, msg: string, meta?: Meta): string =>
	JSON.stringify({ ts: new Date().toISOString(), level, msg, ...(meta ?? {}) });

export const workerLogger = {
	info: (msg: string, meta?: Meta) => console.log(format('info', msg, meta)),
	warn: (msg: string, meta?: Meta) => console.warn(format('warn', msg, meta)),
	error: (msg: string, meta?: Meta) => console.error(format('error', msg, meta)),
	debug: (msg: string, meta?: Meta) => console.debug(format('debug', msg, meta))
};

export type WorkerLogger = typeof workerLogger;
