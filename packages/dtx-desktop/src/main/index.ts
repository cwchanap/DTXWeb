import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron';
import { join } from 'path';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';
import { URL } from 'url';
import fs from 'fs';
import { SimFile, type SimfileWithDtx } from '@dtx/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Initialize Supabase client for main process
let supabaseClient: SupabaseClient | null = null;
let currentSession: any = null;

function initializeSupabase() {
	// Get environment variables from import.meta.env (main process)
	const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL;
	const SUPABASE_ANON_KEY = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

	if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
		console.error('Missing Supabase environment variables in main process');
		return null;
	}

	supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
	return supabaseClient;
}

// Function to verify magic link in main process
async function verifyMagicLink(magicLinkUrl: string) {
	try {
		if (!supabaseClient) {
			supabaseClient = initializeSupabase();
			if (!supabaseClient) {
				throw new Error('Failed to initialize Supabase client');
			}
		}

		// Extract the token from the magic link URL
		const url = new URL(magicLinkUrl);
		const token = url.searchParams.get('token');
		const tokenHash = url.searchParams.get('token_hash');

		if (!token && !tokenHash) {
			throw new Error('No token found in magic link');
		}

		// Use token_hash if available, otherwise use token
		const authToken = tokenHash || token;
		if (!authToken) {
			throw new Error('Invalid token in magic link');
		}

		console.log('Verifying magic link token in main process...');

		// Verify the OTP token with Supabase
		const { data, error } = await supabaseClient.auth.verifyOtp({
			token_hash: authToken,
			type: 'magiclink'
		});

		if (error) {
			console.error('Failed to verify magic link token:', error);
			throw error;
		}

		if (!data.session) {
			throw new Error('No session created from magic link');
		}

		console.log('Magic link authentication successful in main process');

		// Store session in main process
		currentSession = data.session;

		return {
			success: true,
			session: data.session,
			user: data.user
		};
	} catch (error) {
		console.error('Failed to authenticate with magic link in main process:', error);
		return {
			success: false,
			error: error instanceof Error ? error.message : 'Unknown error'
		};
	}
}

// SimFile service functions
interface SimFileServiceResult {
	data: SimfileWithDtx[];
	fromCache: boolean;
	error?: string;
}

async function ensureSupabaseAuth(): Promise<boolean> {
	if (!supabaseClient) {
		supabaseClient = initializeSupabase();
		if (!supabaseClient) {
			return false;
		}
	}

	if (!currentSession) {
		return false;
	}

	return true;
}

async function fetchUserSimFiles(): Promise<SimFileServiceResult> {
	try {
		// Ensure auth is initialized
		const isAuthReady = await ensureSupabaseAuth();
		if (!isAuthReady) {
			throw new Error('Authentication not available. Please log in first.');
		}

		// Get authenticated user
		const {
			data: { user },
			error: authError
		} = await supabaseClient!.auth.getUser();

		if (authError) {
			throw new Error(`Authentication error: ${authError.message}`);
		}

		if (!user) {
			throw new Error('User not authenticated');
		}

		// Fetch simFiles from Supabase - based on ChartList.svelte query
		const { data, error } = await supabaseClient!
			.from('simfiles')
			.select(
				`id, title, artist, bpm, preview_url, sound_preview_url, download_url, is_published, display_id, publish_date, created_at, updated_at, user_id, video_preview_url, dtx_files(level)`
			)
			.eq('user_id', user.id)
			.order('publish_date', { ascending: false });

		if (error) {
			throw new Error(`Failed to fetch simFiles: ${error.message}`);
		}

		const simFiles = data || [];

		return {
			data: simFiles,
			fromCache: false
		};
	} catch (error) {
		console.error('Error fetching simFiles:', error);
		return {
			data: [],
			fromCache: false,
			error: error instanceof Error ? error.message : 'Unknown error occurred'
		};
	}
}

function getPreviewUrl(preview_url: string): string {
	if (!supabaseClient) {
		throw new Error('Supabase client not initialized');
	}
	const PREVIEW_BUCKET_NAME = 'simfile-previews';
	return supabaseClient.storage.from(PREVIEW_BUCKET_NAME).getPublicUrl(`${preview_url}`).data
		.publicUrl;
}

function getSoundPreviewUrl(sound_preview_url: string | null): string | null {
	if (!sound_preview_url) return null;
	if (!supabaseClient) {
		throw new Error('Supabase client not initialized');
	}
	const SOUND_PREVIEW_BUCKET_NAME = 'simfile-sound-previews';
	return supabaseClient.storage
		.from(SOUND_PREVIEW_BUCKET_NAME)
		.getPublicUrl(`${sound_preview_url}`).data.publicUrl;
}

function createWindow(): void {
	// Create the browser window.
	const mainWindow = new BrowserWindow({
		width: 900,
		height: 670,
		show: false,
		autoHideMenuBar: true,
		webPreferences: {
			preload: join(__dirname, '../preload/index.js'),
			sandbox: false
		}
	});

	mainWindow.on('ready-to-show', () => {
		mainWindow.show();
	});

	mainWindow.webContents.setWindowOpenHandler((details) => {
		shell.openExternal(details.url);
		return { action: 'deny' };
	});

	// HMR for renderer base on electron-vite cli.
	// Load the remote URL for development or the local html file for production.
	if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
		mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
	} else {
		mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
	}
}

// Make sure we're the only instance of the app
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
	app.quit();
} else {
	// This method will be called when Electron has finished
	// initialization and is ready to create browser windows.
	// Some APIs can only be used after this event occurs.
	app.whenReady().then(() => {
		// Set app user model id for windows
		electronApp.setAppUserModelId('com.electron');

		// Default open or close DevTools by F12 in development
		// and ignore CommandOrControl + R in production.
		// see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
		app.on('browser-window-created', (_, window) => {
			optimizer.watchWindowShortcuts(window);
		});

		// IPC test
		ipcMain.on('ping', () => console.log('pong'));

		// Handle external URL opening request from renderer
		ipcMain.on('open-external-url', (_event, url) => {
			shell.openExternal(url);
		});

		// Handle directory selection dialog
		ipcMain.handle('select-directory', async () => {
			const result = await dialog.showOpenDialog({
				properties: ['openDirectory']
			});
			return result;
		});

		// Handle listing directories in a path
		ipcMain.handle('list-directories', async (_event, dirPath) => {
			try {
				console.log('Listing directories in:', dirPath);
				const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

				// Filter only directories
				const directories = entries
					.filter((entry) => entry.isDirectory())
					.map((dir) => dir.name);

				console.log('Found directories:', directories);
				return directories;
			} catch (error) {
				console.error('Error listing directories:', error);
				return [];
			}
		});

		// Handle loading tree structure with lazy loading
		ipcMain.handle('load-tree-structure', async (_event, dirPath) => {
			try {
				console.log('Loading tree structure for:', dirPath);
				const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

				// Filter only directories and create tree nodes
				const allDirectories = entries.filter((entry) => entry.isDirectory());

				const treeNodes = await Promise.all(
					allDirectories.map(async (dir) => {
						const fullPath = `${dirPath}/${dir.name}`;

						// Check if directory has subdirectories
						let hasChildren = false;
						let containsDtxFiles = false;
						let songTitle: string | null = null;

						try {
							const subEntries = await fs.promises.readdir(fullPath, {
								withFileTypes: true
							});

							// Check for subdirectories
							hasChildren = subEntries.some((entry) => entry.isDirectory());

							// Check for .dtx files
							containsDtxFiles = subEntries.some(
								(entry) =>
									entry.isFile() && entry.name.toLowerCase().endsWith('.dtx')
							);

							// If folder contains .dtx files, check for SET.def and read song title
							if (containsDtxFiles) {
								const setDefFile = subEntries.find(
									(entry) =>
										entry.isFile() && entry.name.toLowerCase() === 'set.def'
								);

								if (setDefFile) {
									try {
										const setDefPath = `${fullPath}/${setDefFile.name}`;
										// Read as buffer to preserve original encoding
										const setDefBuffer = await fs.promises.readFile(setDefPath);

										// Create a File object from the buffer to use with SimFile
										const file = new File([setDefBuffer], 'set.def');
										const simFile = new SimFile([file]);
										await simFile.parseHeader(file);
										songTitle = simFile.title || null;
										console.log('Song title:', songTitle);
									} catch (error) {
										console.warn('Could not read SET.def file:', error);
									}
								}
							}
						} catch (error) {
							console.warn('Could not check subdirectories for:', fullPath);
						}

						return {
							name: dir.name,
							path: fullPath,
							isExpanded: false,
							isLoading: false,
							children: [],
							hasChildren: containsDtxFiles ? false : hasChildren, // Don't show children for folders with .dtx files
							containsDtxFiles,
							songTitle
						};
					})
				);

				// Filter nodes: show DTXFiles folders and folders containing .dtx files
				const filteredNodes = treeNodes.filter(
					(node) => node.name.startsWith('DTXFiles.') || node.containsDtxFiles
				);

				return filteredNodes;
			} catch (error) {
				console.error('Error loading tree structure:', error);
				return [];
			}
		});

		// Handle reading file contents
		ipcMain.handle('read-file', async (_event, filePath) => {
			try {
				console.log('Reading file:', filePath);
				const content = await fs.promises.readFile(filePath, 'utf-8');
				return content;
			} catch (error) {
				console.error('Error reading file:', error);
				throw error;
			}
		});

		// Handle magic link verification in main process
		ipcMain.handle('verify-magic-link', async (_event, magicLinkUrl) => {
			return await verifyMagicLink(magicLinkUrl);
		});

		// Handle session validation
		ipcMain.handle('validate-session', async (_event, sessionData) => {
			try {
				if (!supabaseClient) {
					supabaseClient = initializeSupabase();
					if (!supabaseClient) {
						return false;
					}
				}

				// Set the session and check if it's valid
				const { error } = await supabaseClient.auth.setSession({
					access_token: sessionData.accessToken,
					refresh_token: sessionData.refreshToken
				});

				if (error) {
					console.error('Session validation failed:', error);
					return false;
				}

				// Get current session to verify it's still valid
				const {
					data: { session },
					error: sessionError
				} = await supabaseClient.auth.getSession();

				if (sessionError || !session) {
					console.error('Session is invalid:', sessionError);
					return false;
				}

				// Update stored session
				currentSession = session;
				return true;
			} catch (error) {
				console.error('Failed to validate session:', error);
				return false;
			}
		});

		// Handle getting current session
		ipcMain.handle('get-current-session', async () => {
			return currentSession;
		});

		// Handle logout
		ipcMain.handle('logout-session', async () => {
			try {
				if (supabaseClient && currentSession) {
					await supabaseClient.auth.signOut();
				}
				currentSession = null;
				console.log('Session logged out in main process');
				return true;
			} catch (error) {
				console.error('Failed to logout session in main process:', error);
				currentSession = null; // Clear it anyway
				return false;
			}
		});

		// SimFile service handlers
		ipcMain.handle('fetch-user-simfiles', async () => {
			return await fetchUserSimFiles();
		});

		ipcMain.handle('get-preview-url', async (_event, preview_url: string) => {
			return getPreviewUrl(preview_url);
		});

		ipcMain.handle(
			'get-sound-preview-url',
			async (_event, sound_preview_url: string | null) => {
				return getSoundPreviewUrl(sound_preview_url);
			}
		);

		// Register custom protocol handler (dtx://)
		const PROTOCOL = 'dtx';

		if (!app.isDefaultProtocolClient(PROTOCOL)) {
			app.setAsDefaultProtocolClient(PROTOCOL);
		}

		// Handle protocol. This is called when your app is opened with the custom URL
		// macOS protocol handler
		app.on('open-url', (event, url) => {
			event.preventDefault();
			handleProtocolUrl(url);
		});

		// Windows protocol handler (for when app is not running)
		app.on('second-instance', (_, commandLine) => {
			// Someone tried to run a second instance, we should focus our window.
			if (BrowserWindow.getAllWindows().length > 0) {
				const mainWindow = BrowserWindow.getAllWindows()[0];
				if (mainWindow.isMinimized()) mainWindow.restore();
				mainWindow.focus();

				// Check if this is a protocol URL (Windows passes full command line)
				const protocolUrl = commandLine.find((arg) => arg.startsWith(`${PROTOCOL}://`));
				if (protocolUrl) {
					handleProtocolUrl(protocolUrl);
				}
			}
		});

		// Helper function to handle protocol URLs
		async function handleProtocolUrl(url: string) {
			try {
				const parsedUrl = new URL(url);

				if (parsedUrl.hostname === 'auth-callback') {
					// Check for magic link first (new approach)
					const magicLink = parsedUrl.searchParams.get('magic_link');

					if (magicLink && BrowserWindow.getAllWindows().length > 0) {
						// Get main window
						const mainWindow = BrowserWindow.getAllWindows()[0];

						// Verify magic link in main process
						const result = await verifyMagicLink(decodeURIComponent(magicLink));

						// Send result to renderer process
						mainWindow.webContents.send('magic-link-result', result);
						return;
					}

					// Fallback to legacy token approach
					const accessToken = parsedUrl.searchParams.get('access_token');
					const refreshToken = parsedUrl.searchParams.get('refresh_token');

					if (accessToken && refreshToken && BrowserWindow.getAllWindows().length > 0) {
						// Get main window
						const mainWindow = BrowserWindow.getAllWindows()[0];

						// Send both tokens to the renderer process
						mainWindow.webContents.send('auth-callback', { accessToken, refreshToken });
					}
				}
			} catch (error) {
				console.error('Failed to parse protocol URL:', error);
			}
		}

		createWindow();

		app.on('activate', function () {
			// On macOS it's common to re-create a window in the app when the
			// dock icon is clicked and there are no other windows open.
			if (BrowserWindow.getAllWindows().length === 0) createWindow();
		});
	});

	// Quit when all windows are closed, except on macOS. There, it's common
	// for applications and their menu bar to stay active until the user quits
	// explicitly with Cmd + Q.
	app.on('window-all-closed', () => {
		if (process.platform !== 'darwin') {
			app.quit();
		}
	});
}

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
