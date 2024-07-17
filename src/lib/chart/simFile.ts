import JSZip from 'jszip';

interface DtxLevel {
    label: string;
    file: string;
}

export class SimFile {
    public title!: string;
    public levels: { [key: number]: DtxLevel } = {};

	constructor(public files: File[]) {}

    public async parse() {
        // search for `def` file
        const defFile = this.files.find((file) => file.name.endsWith('.def'));
        if (!defFile) {
            throw new Error('No .def file found');
        }        
        await this.parseHeader(defFile);
    }

	public static async parseFromZip(file: string) {
		const zip = new JSZip();
		const zipContent = await zip.loadAsync(file);
		const extracted = [];

		for (const [name, zipEntry] of Object.entries(zipContent.files)) {
			if (!zipEntry.dir) {
				const file = await zipEntry.async('blob');
                extracted.push(new File([file], name));
			}
		}
        return new SimFile(extracted);
	}

    public getZip() {
        const zip = new JSZip();
        for (const file of this.files) {
            zip.file(file.name, file);
        }
        return zip;
    }

    public async parseHeader(file: File) {
        const content = await file.text();
        const lines = content.split('\r\n');

        const title_line = lines.find((line) => line.startsWith('#TITLE '));
        this.title = title_line ? title_line.split('#TITLE ')[1] : '';

        [1, 2, 3, 4, 5].forEach((level) => {
            const level_line = lines.find((line) => line.startsWith(`#L${level}LABEL `));
            const file_line = lines.find((line) => line.startsWith(`#L${level}FILE `));
            if (level_line && file_line) {
                const label = level_line.split(' ')[1];
                const file = file_line.split(' ')[1];
                this.levels[level] = { label, file };
            }
        });
    }
}
