import JSZip from 'jszip';
import { DTXFile } from './dtx';
import { decodeFileWithEncodingDetection } from './encoding-utils';
import { parseSetDef, normalizeSetDefFileName } from './setDef';
import { dedupedFetch } from '../utils/dedupedFetch';

interface DtxLevel {
	label: string;
	file: DTXFile;
}

const encodeR2Path = (path: string): string => path.split('/').map(encodeURIComponent).join('/');

export class SimFile {
	private isParseFromRemoteURL: boolean = false;
	private simFileID: string = '';
	private bucketUrl: string = '';
	public title!: string;
	public levels: { [key: number]: DtxLevel | undefined } = {};

	constructor(
		public files: File[],
		bucketUrl?: string
	) {
		if (bucketUrl) {
			this.bucketUrl = bucketUrl;
		}
	}

	public async parse() {
		// search for `def` file
		const defFile = this.files.find((file) => file.name.endsWith('.def'));
		if (!defFile) {
			throw new Error('No .def file found');
		}
		await this.parseHeader(defFile);
	}

	public static async parseFromZip(file: string, bucketUrl?: string) {
		const zip = new JSZip();
		const zipContent = await zip.loadAsync(file);
		const extracted = [];

		for (const [name, zipEntry] of Object.entries(zipContent.files)) {
			if (!zipEntry.dir) {
				const file = await zipEntry.async('blob');
				extracted.push(new File([file], name));
			}
		}
		return new SimFile(extracted, bucketUrl);
	}

	/**
	 * Parse SimFile from remote URL by fetching SET.def client-side
	 * Used for dtx-desktop and dtx-web development (when R2 bucket is not available)
	 * In production dtx-web, prefer parseFromRemoteURLWithMetadata() with server-side metadata
	 */
	public static async parseFromRemoteURL(simfileID: string, bucketUrl: string) {
		const response = await dedupedFetch(`${bucketUrl}/${simfileID}/set.def`);
		if (!response.ok) {
			throw new Error(
				`Failed to fetch set.def for ${simfileID}: ${response.status} ${response.statusText}`
			);
		}
		const file = new File([await response.blob()], 'set.def');
		const simFile = new SimFile([file], bucketUrl);
		simFile.isParseFromRemoteURL = true;
		simFile.simFileID = simfileID;
		await simFile.parse();
		return simFile;
	}

	/**
	 * Parse SimFile from remote URL using server-provided metadata
	 * This method avoids client-side SET.def fetching and is the preferred method for dtx-web
	 */
	public static async parseFromRemoteURLWithMetadata(
		simfileID: string,
		bucketUrl: string,
		metadata: {
			title: string;
			levels: { [key: number]: { label: string; fileName: string } | undefined };
		}
	) {
		const simFile = new SimFile([], bucketUrl);
		simFile.isParseFromRemoteURL = true;
		simFile.simFileID = simfileID;
		simFile.title = metadata.title;

		// Parse levels using provided metadata instead of fetching set.def.
		// Iterate the actual metadata keys — server-side SET.def parsing can
		// surface slots beyond the conventional L1–L5 range.
		const promises = Object.entries(metadata.levels).map(async ([levelKey, levelData]) => {
			if (!levelData) {
				return;
			}
			const level = Number(levelKey);
			const { label, fileName } = levelData;
			try {
				// Server-provided fileName is verbatim SET.def text; normalize
				// the same way parseHeader does or `.\name.dtx` fetches 404.
				// Preserve the distinction between bare `42/adv.dtx` and
				// explicitly relative `./42/adv.dtx`, and encode each path
				// segment so `#` or spaces do not truncate the URL. A bare path
				// starting with `{simfileID}/` is ambiguous (already-prefixed
				// key vs a subfolder named after the simfile ID), so try the
				// nested `{simfileID}/{normalizedFileName}` key when the direct
				// lookup returns 404.
				const trimmedFileName = fileName.trim();
				const explicitlyRelative = /^\.[\\/]/.test(trimmedFileName);
				const normalizedFileName = normalizeSetDefFileName(fileName);
				const isAmbiguousPrefixed =
					!explicitlyRelative && normalizedFileName.startsWith(`${simfileID}/`);
				const objectKey = isAmbiguousPrefixed
					? normalizedFileName
					: `${simfileID}/${normalizedFileName}`;
				let response = await dedupedFetch(`${bucketUrl}/${encodeR2Path(objectKey)}`);
				if (
					!response.ok &&
					isAmbiguousPrefixed &&
					(response.status === 404 || response.status === undefined)
				) {
					response = await dedupedFetch(
						`${bucketUrl}/${encodeR2Path(`${simfileID}/${normalizedFileName}`)}`
					);
				}
				if (!response.ok) {
					return;
				}
				const file = new File([await response.blob()], normalizedFileName);
				const dtx = new DTXFile(file, label);
				await dtx.parse();
				simFile.levels[level] = { label, file: dtx };
			} catch (error) {
				console.error(`Failed to load DTX file ${fileName}:`, error);
			}
		});

		await Promise.all(promises);
		return simFile;
	}

	/**
	 * Parse a single DTX difficulty level directly from its remote file URL.
	 *
	 * Used by the preview tab, which only renders one level at a time: fetching
	 * just the selected level (instead of all five via parseFromRemoteURL)
	 * avoids four unnecessary DTX round-trips on load and on each level switch.
	 *
	 * @param fileUrl Fully-qualified URL to the .dtx file (e.g. the catalog
	 *   `fileUrl` resolved server-side from R2).
	 * @param label   Difficulty label for the resulting DTXFile.
	 */
	public static async parseLevelFromRemoteURL(fileUrl: string, label: string): Promise<DTXFile> {
		const response = await dedupedFetch(fileUrl);
		if (!response.ok) {
			throw new Error(
				`Failed to fetch DTX file ${fileUrl}: ${response.status} ${response.statusText}`
			);
		}
		// Derive a filename from the URL so DTXFile.getFileName() still works
		// (used downstream by the editor and MIDI export). Strip any query/hash
		// first: R2/CDN signed URLs append `?X-Amz-Signature=...` which would
		// otherwise become part of the derived filename.
		const lastSegment = fileUrl.split('/').pop() ?? 'chart.dtx';
		const fileName = decodeURIComponent(lastSegment.split(/[?#]/)[0]);
		const file = new File([await response.blob()], fileName);
		const dtx = new DTXFile(file, label);
		await dtx.parse();
		return dtx;
	}

	public getZip() {
		const zip = new JSZip();
		for (const file of this.files) {
			zip.file(file.name, file);
		}
		return zip;
	}

	private async readFileWithEncoding(file: File): Promise<string> {
		// SimFile (.def) validation callback. Mirrors parseSetDef's contract —
		// case-insensitive directives on any positive level slot — so a file
		// that decodes correctly only under a later encoding (e.g. UTF-16LE
		// lowercase) still passes the heuristic instead of falling back to
		// UTF-8 garbage.
		const validateSimFileContent = (content: string): boolean => {
			return (
				/#title/i.test(content) || /#l\d+label/i.test(content) || /#l\d+file/i.test(content)
			);
		};

		const result = await decodeFileWithEncodingDetection(
			file,
			validateSimFileContent,
			['utf-8', 'shift-jis', 'utf-16le', 'utf-16be'], // SimFile (.def) typically uses utf-8 first
			'utf-8' // SimFile fallback is utf-8
		);
		return result.content;
	}

	public async parseHeader(file: File) {
		const content = await this.readFileWithEncoding(file);
		const parsed = parseSetDef(content);
		this.title = parsed.title;

		const setDefSlash = file.name.lastIndexOf('/');
		const setDefDir = setDefSlash >= 0 ? file.name.slice(0, setDefSlash + 1) : '';

		const promises = parsed.levels.map(async ({ level, label, fileName }) => {
			// SET.def written on Windows uses `\` separators and `.\` / `./`
			// prefixes; File names and R2 keys use `/` paths without them.
			const normalizedFileName = normalizeSetDefFileName(fileName);
			let dtxSourceFile;
			if (!this.isParseFromRemoteURL) {
				dtxSourceFile =
					(setDefDir
						? this.files.find((f) => f.name === `${setDefDir}${normalizedFileName}`)
						: undefined) ?? this.files.find((f) => f.name === normalizedFileName);
			} else {
				const response = await dedupedFetch(
					`${this.bucketUrl}/${this.simFileID}/${encodeR2Path(normalizedFileName)}`
				);
				if (!response.ok) {
					return;
				}
				dtxSourceFile = new File([await response.blob()], normalizedFileName);
			}
			if (!dtxSourceFile) {
				return;
			}
			const dtx = new DTXFile(dtxSourceFile, label);
			await dtx.parse();
			this.levels[level] = { label, file: dtx };
		});

		await Promise.all(promises);
	}

	public getLevel(level: number | undefined) {
		return level ? this.levels[level]?.file : this.getHighestLevel();
	}

	public getHighestLevel() {
		// Highest populated numeric slot — not capped at L5, since remote
		// metadata and local SET.def parsing can surface L6+ charts.
		const highest = Object.keys(this.levels)
			.map(Number)
			.filter((level) => Number.isInteger(level))
			.sort((a, b) => b - a)
			.map((level) => this.levels[level])
			.find((entry) => entry !== undefined);
		if (!highest) {
			throw new Error('No levels found');
		}
		return highest.file;
	}

	public getPreviewFile() {
		const preview = this.getHighestLevel().preview;
		const previewFile = this.files.find((file) => file.name === preview);
		if (!previewFile) {
			throw new Error('Preview file not found');
		}
		return previewFile;
	}

	public getSoundPreviewFile() {
		const preview = this.getHighestLevel().soundPreview;
		const previewFile = this.files.find((file) => file.name === preview);
		if (!previewFile) {
			throw new Error('Preview file not found');
		}
		return previewFile;
	}

	public getPreview() {
		return URL.createObjectURL(this.getPreviewFile());
	}

	public getSoundPreview() {
		return URL.createObjectURL(this.getSoundPreviewFile());
	}

	/**
	 * Generate def file content with current simFile data
	 * @returns The def file content as a string
	 */
	public generateDefFileContent(): string {
		const lines: string[] = [];

		// Add title if it exists
		if (this.title) {
			lines.push(`#TITLE ${this.title}`);
		}

		// Default level settings with default filenames
		const defaultLevels = [
			{ level: 1, defaultFile: 'bas.dtx' },
			{ level: 2, defaultFile: 'adv.dtx' },
			{ level: 3, defaultFile: 'ext.dtx' },
			{ level: 4, defaultFile: 'mas.dtx' },
			{ level: 5, defaultFile: 'real.dtx' }
		];

		// Add level information
		for (const { level, defaultFile } of defaultLevels) {
			const levelData = this.levels[level];
			if (levelData) {
				// Use existing level data
				lines.push(`#L${level}LABEL ${levelData.label}`);
				// Try to get filename from the DTXFile using the safe getFileName method
				const fileName = levelData.file.getFileName() || defaultFile;
				lines.push(`#L${level}FILE ${fileName}`);
			} else {
				// Use default values
				const defaultLabels = ['BASIC', 'ADVANCED', 'EXTREME', 'MASTER', 'REAL'];
				lines.push(`#L${level}LABEL ${defaultLabels[level - 1]}`);
				lines.push(`#L${level}FILE ${defaultFile}`);
			}
		}

		// Retain populated slots beyond the conventional L1–L5 range so L6+
		// charts survive a def round-trip. Slots whose file has no resolvable
		// name are skipped — an orphaned label would fail the complete-pair
		// requirement on reparse anyway.
		const extraLevels = Object.keys(this.levels)
			.map(Number)
			.filter((level) => Number.isInteger(level) && level > 5)
			.sort((a, b) => a - b);
		for (const level of extraLevels) {
			const levelData = this.levels[level];
			const fileName = levelData?.file.getFileName();
			if (!levelData || !fileName) continue;
			lines.push(`#L${level}LABEL ${levelData.label}`);
			lines.push(`#L${level}FILE ${fileName}`);
		}

		return lines.join('\n');
	}
}
