import JSZip from 'jszip';
import { DTXFile } from './dtx.js';

interface DtxLevel {
	label: string;
	file: DTXFile;
}

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

	public static async parseFromRemoteURL(simfileID: string, bucketUrl: string) {
		const response = await fetch(`${bucketUrl}/${simfileID}/set.def`);
		const file = new File([await response.blob()], 'set.def');
		const simFile = new SimFile([file], bucketUrl);
		simFile.isParseFromRemoteURL = true;
		simFile.simFileID = simfileID;
		await simFile.parse();
		return simFile;
	}

	public getZip() {
		const zip = new JSZip();
		for (const file of this.files) {
			zip.file(file.name, file);
		}
		return zip;
	}

	private async readFileWithEncoding(file: File): Promise<string> {
		const arrayBuffer = await file.arrayBuffer();

		// List of encodings to try in order
		const encodings = ['utf-8', 'shift-jis', 'utf-16le', 'utf-16be'];

		for (const encoding of encodings) {
			try {
				const decoder = new TextDecoder(encoding);
				const content = decoder.decode(arrayBuffer);

				console.log(`Trying encoding: ${encoding}`);
				console.log(`Content preview (first 100 chars):`, content.substring(0, 100));

				// Check if the content looks valid (contains expected DTX header patterns)
				if (
					content.includes('#TITLE') ||
					content.includes('#L1LABEL') ||
					content.includes('#L1FILE')
				) {
					// Additional check: ensure no excessive null bytes (which would indicate wrong encoding)
					const nullByteRatio = (content.match(/\0/g) || []).length / content.length;
					console.log(`Null byte ratio for ${encoding}:`, nullByteRatio);
					if (nullByteRatio < 0.1) {
						// Less than 10% null bytes
						console.log(`Successfully detected encoding: ${encoding}`);
						return content;
					}
				}
			} catch (error) {
				console.log(`Failed to decode with ${encoding}:`, error);
				// Continue to next encoding if this one fails
				continue;
			}
		}

		// Fallback to UTF-8 if nothing else works
		const decoder = new TextDecoder('utf-8');
		return decoder.decode(arrayBuffer);
	}

	public async parseHeader(file: File) {
		const content = await this.readFileWithEncoding(file);
		const lines = content.split(/\r?\n/);

		const title_line = lines.find((line: string) => line.startsWith('#TITLE '));
		this.title = title_line ? title_line.split('#TITLE ')[1] : '';

		const promises = [1, 2, 3, 4, 5].map(async (level) => {
			const level_line = lines.find((line: string) => line.startsWith(`#L${level}LABEL `));
			const file_line = lines.find((line: string) => line.startsWith(`#L${level}FILE `));
			if (level_line && file_line) {
				const label = level_line.split(' ')[1];
				const file_name = file_line.split(' ')[1];
				let file;
				if (!this.isParseFromRemoteURL) {
					file = this.files.find((f) => f.name === file_name);
				} else {
					const response = await fetch(
						`${this.bucketUrl}/${this.simFileID}/${file_name}`
					);
					if (!response.ok) {
						return;
					}
					file = new File([await response.blob()], file_name);
				}
				if (!file) {
					return;
				}
				const dtx = new DTXFile(file, label);
				await dtx.parse();
				this.levels[level] = { label, file: dtx };
			}
		});

		await Promise.all(promises);
	}

	public getLevel(level: number | undefined) {
		return level ? this.levels[level]?.file : this.getHighestLevel();
	}

	public getHighestLevel() {
		const highest =
			this.levels[5] || this.levels[4] || this.levels[3] || this.levels[2] || this.levels[1];
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
}
