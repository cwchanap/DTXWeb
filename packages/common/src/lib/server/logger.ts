import winston from 'winston';

const logger = winston.createLogger({
	level: 'info',
	format: winston.format.combine(
		winston.format.timestamp(),
		winston.format.errors({ stack: true }),
		winston.format.splat(),
		winston.format.printf(({ timestamp, level, message, ...meta }) => {
			const metaStr =
				Object.keys(meta).length > 0
					? ' ' +
						JSON.stringify(meta, (_, v) =>
							v instanceof Error ? { message: v.message, stack: v.stack } : v
						)
					: '';
			return `${timestamp} [${level}]: ${message}${metaStr}`;
		})
	),
	transports: [new winston.transports.Console()]
});

export default logger;
