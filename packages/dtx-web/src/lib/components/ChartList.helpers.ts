import { bulkDownloadBaseUrl, bulkDownloadHeaders } from '$lib/api';

export type SaveFilePickerHandle = {
	createWritable: () => Promise<WritableStream<Uint8Array>>;
};

export type SaveFilePickerWindow = {
	showSaveFilePicker?: (options?: {
		suggestedName?: string;
		types?: Array<{
			description: string;
			accept: Record<string, string[]>;
		}>;
	}) => Promise<SaveFilePickerHandle>;
};

export type BulkDownloadTarget = SaveFilePickerHandle | WritableStream<Uint8Array>;

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const DEFAULT_BULK_DOWNLOAD_FILENAME = 'drumery-charts.zip';

export const MAX_BULK_DOWNLOAD_CHARTS = 20;
export const BULK_DOWNLOAD_UNSUPPORTED_MESSAGE =
	'Bulk download requires a browser that supports direct file saving.';

const createBulkDownloadRequestInit = async (ids: number[]): Promise<RequestInit> => ({
	method: 'POST',
	headers: await bulkDownloadHeaders(),
	body: JSON.stringify({ ids })
});

const getResponseErrorMessage = async (response: Response, fallback: string) => {
	try {
		const data = (await response.json()) as { error?: unknown };
		if (typeof data?.error === 'string') {
			return data.error;
		}
	} catch {
		// ignore parse error
	}

	return fallback;
};

export const supportsBulkDownloadStreaming = (saveFilePickerWindow: SaveFilePickerWindow) =>
	typeof saveFilePickerWindow.showSaveFilePicker === 'function';

export const resetBulkSelection = () => new Set<number>();

export const canBulkSelect = (item: { has_uploaded_files?: boolean }) =>
	item.has_uploaded_files === true;

export const changePage = (newPage: number, totalPages: number) => {
	if (newPage < 1 || newPage > totalPages) {
		return null;
	}

	return {
		currentPage: newPage,
		selectedIds: resetBulkSelection()
	};
};

export const handlePageSizeChange = (pageSize: number) => ({
	pageSize,
	currentPage: 1,
	selectedIds: resetBulkSelection()
});

export const isAbortError = (error: unknown): boolean => {
	if (error instanceof DOMException) {
		return error.name === 'AbortError';
	}

	return (
		typeof error === 'object' &&
		error !== null &&
		'name' in error &&
		error.name === 'AbortError'
	);
};

export const showBulkDownloadSaveFilePicker = async (
	saveFilePickerWindow: SaveFilePickerWindow,
	suggestedName = DEFAULT_BULK_DOWNLOAD_FILENAME
) => {
	if (!supportsBulkDownloadStreaming(saveFilePickerWindow)) {
		throw new Error(BULK_DOWNLOAD_UNSUPPORTED_MESSAGE);
	}

	const showSaveFilePicker = saveFilePickerWindow.showSaveFilePicker;
	if (!showSaveFilePicker) {
		throw new Error(BULK_DOWNLOAD_UNSUPPORTED_MESSAGE);
	}

	return showSaveFilePicker({
		suggestedName,
		types: [{ description: 'ZIP archive', accept: { 'application/zip': ['.zip'] } }]
	});
};

export const streamToFile = async (response: Response, target: BulkDownloadTarget) => {
	if (!response.body) {
		throw new Error('No response body');
	}

	const writable =
		'createWritable' in target
			? await target.createWritable()
			: (target as WritableStream<Uint8Array>);

	await response.body.pipeTo(writable);
};

export const submitBulkDownload = async (
	fetchFn: FetchLike,
	ids: number[],
	target: BulkDownloadTarget
) => {
	const response = await fetchFn(bulkDownloadBaseUrl(), await createBulkDownloadRequestInit(ids));
	if (!response.ok) {
		throw new Error(await getResponseErrorMessage(response, 'Bulk download failed'));
	}
	await streamToFile(response, target);
};

export const startBulkDownload = async ({
	ids,
	fetchFn,
	saveFilePickerWindow
}: {
	ids: number[];
	fetchFn: FetchLike;
	saveFilePickerWindow: SaveFilePickerWindow;
}) => {
	const target = await showBulkDownloadSaveFilePicker(saveFilePickerWindow);
	const validationResponse = await fetchFn(
		`${bulkDownloadBaseUrl()}?validate=1`,
		await createBulkDownloadRequestInit(ids)
	);

	if (!validationResponse.ok) {
		throw new Error(await getResponseErrorMessage(validationResponse, 'Bulk download failed'));
	}

	const validationData = (await validationResponse.json()) as {
		ok?: unknown;
		fileCount?: unknown;
		error?: unknown;
	};

	if (
		validationData?.ok !== true ||
		typeof validationData.fileCount !== 'number' ||
		validationData.fileCount <= 0
	) {
		throw new Error(
			typeof validationData?.error === 'string'
				? validationData.error
				: 'No uploaded files found for the selected charts'
		);
	}

	await submitBulkDownload(fetchFn, ids, target);

	return validationData.fileCount;
};
