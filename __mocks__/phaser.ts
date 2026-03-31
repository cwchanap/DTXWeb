import { vi } from 'vitest';

// Mock Phaser.GameObjects
const GameObjects = {
	GameObject: class MockGameObject {
		setPosition: ReturnType<typeof vi.fn>;
		setScale: ReturnType<typeof vi.fn>;
		setOrigin: ReturnType<typeof vi.fn>;
		setAlpha: ReturnType<typeof vi.fn>;
		setVisible: ReturnType<typeof vi.fn>;
		setActive: ReturnType<typeof vi.fn>;
		setName: ReturnType<typeof vi.fn>;
		setInteractive: ReturnType<typeof vi.fn>;

		constructor() {
			this.setPosition = vi.fn().mockReturnThis();
			this.setScale = vi.fn().mockReturnThis();
			this.setOrigin = vi.fn().mockReturnThis();
			this.setAlpha = vi.fn().mockReturnThis();
			this.setVisible = vi.fn().mockReturnThis();
			this.setActive = vi.fn().mockReturnThis();
			this.setName = vi.fn().mockReturnThis();
			this.setInteractive = vi.fn().mockReturnThis();
		}
	},
	Container: class MockContainer {
		add: ReturnType<typeof vi.fn>;
		addAt: ReturnType<typeof vi.fn>;
		remove: ReturnType<typeof vi.fn>;
		setSize: ReturnType<typeof vi.fn>;
		setPosition: ReturnType<typeof vi.fn>;
		setMask: ReturnType<typeof vi.fn>;
		setScale: ReturnType<typeof vi.fn>;
		getAll: ReturnType<typeof vi.fn>;
		setName: ReturnType<typeof vi.fn>;
		getByName: ReturnType<typeof vi.fn>;
		list: unknown[];
		y: number;

		constructor() {
			this.add = vi.fn();
			this.addAt = vi.fn();
			this.remove = vi.fn();
			this.setSize = vi.fn();
			this.setPosition = vi.fn();
			this.setMask = vi.fn();
			this.setScale = vi.fn();
			this.getAll = vi.fn().mockReturnValue([]);
			this.setName = vi.fn();
			this.getByName = vi.fn();
			this.list = [];
			this.y = 0;
		}
	},
	Graphics: class MockGraphics {
		fillStyle: ReturnType<typeof vi.fn>;
		fillRect: ReturnType<typeof vi.fn>;
		lineStyle: ReturnType<typeof vi.fn>;
		moveTo: ReturnType<typeof vi.fn>;
		lineTo: ReturnType<typeof vi.fn>;
		strokePath: ReturnType<typeof vi.fn>;
		createGeometryMask: ReturnType<typeof vi.fn>;
		clear: ReturnType<typeof vi.fn>;
		strokeRect: ReturnType<typeof vi.fn>;
		setName: ReturnType<typeof vi.fn>;
		destroy: ReturnType<typeof vi.fn>;
		name: string;

		constructor() {
			this.fillStyle = vi.fn().mockReturnThis();
			this.fillRect = vi.fn().mockReturnThis();
			this.lineStyle = vi.fn().mockReturnThis();
			this.moveTo = vi.fn().mockReturnThis();
			this.lineTo = vi.fn().mockReturnThis();
			this.strokePath = vi.fn().mockReturnThis();
			this.createGeometryMask = vi.fn().mockReturnValue({});
			this.clear = vi.fn().mockReturnThis();
			this.strokeRect = vi.fn().mockReturnThis();
			this.setName = vi.fn().mockReturnThis();
			this.destroy = vi.fn();
			this.name = '';
		}
	},
	Sprite: class MockSprite {
		setOrigin: ReturnType<typeof vi.fn>;
		setScale: ReturnType<typeof vi.fn>;
		play: ReturnType<typeof vi.fn>;

		constructor() {
			this.setOrigin = vi.fn().mockReturnThis();
			this.setScale = vi.fn().mockReturnThis();
			this.play = vi.fn().mockReturnThis();
		}
	},
	Text: class MockText {
		setOrigin: ReturnType<typeof vi.fn>;
		setAlpha: ReturnType<typeof vi.fn>;
		setName: ReturnType<typeof vi.fn>;

		constructor() {
			this.setOrigin = vi.fn().mockReturnThis();
			this.setAlpha = vi.fn().mockReturnThis();
			this.setName = vi.fn().mockReturnThis();
		}
	},
	Rectangle: class MockRectangle {
		setPosition: ReturnType<typeof vi.fn>;
		setSize: ReturnType<typeof vi.fn>;
		setVisible: ReturnType<typeof vi.fn>;
		setStrokeStyle: ReturnType<typeof vi.fn>;
		x: number;
		y: number;
		width: number;
		height: number;

		constructor() {
			this.setPosition = vi.fn().mockReturnThis();
			this.setSize = vi.fn().mockReturnThis();
			this.setVisible = vi.fn().mockReturnThis();
			this.setStrokeStyle = vi.fn().mockReturnThis();
			this.x = 0;
			this.y = 0;
			this.width = 0;
			this.height = 0;
		}
	}
};

// Mock Phaser.Sound
const Sound = {
	WebAudioSound: class MockWebAudioSound {
		play: ReturnType<typeof vi.fn>;
		stop: ReturnType<typeof vi.fn>;

		constructor() {
			this.play = vi.fn();
			this.stop = vi.fn();
		}
	}
};

// Mock Phaser.Tweens
const Tweens = {
	Tween: class MockTween {
		stop: ReturnType<typeof vi.fn>;
		destroy: ReturnType<typeof vi.fn>;

		constructor() {
			this.stop = vi.fn();
			this.destroy = vi.fn();
		}
	}
};

// Mock Phaser.Events
const Events = {
	EventEmitter: class MockEventEmitter {
		on: ReturnType<typeof vi.fn>;
		once: ReturnType<typeof vi.fn>;
		emit: ReturnType<typeof vi.fn>;
		off: ReturnType<typeof vi.fn>;

		constructor() {
			this.on = vi.fn();
			this.once = vi.fn();
			this.emit = vi.fn();
			this.off = vi.fn();
		}
	}
};

// Mock Phaser.Scene
const Scene = class MockScene {
	constructor(config = {}) {
		Object.assign(this, config);
	}

	input = {
		keyboard: {
			createCursorKeys: vi.fn(),
			on: vi.fn(),
			off: vi.fn()
		},
		on: vi.fn(),
		off: vi.fn(),
		setDefaultCursor: vi.fn()
	};
	add = {
		gameObject: vi.fn().mockReturnValue(new GameObjects.GameObject()),
		container: vi.fn().mockReturnValue(new GameObjects.Container()),
		graphics: vi.fn().mockReturnValue(new GameObjects.Graphics()),
		sprite: vi.fn().mockReturnValue(new GameObjects.Sprite()),
		text: vi.fn().mockReturnValue(new GameObjects.Text()),
		rectangle: vi.fn().mockReturnValue(new GameObjects.Rectangle())
	};

	make = {
		graphics: vi.fn().mockReturnValue(new GameObjects.Graphics())
	};

	cameras = {
		main: {
			setBounds: vi.fn(),
			setZoom: vi.fn(),
			setOrigin: vi.fn(),
			height: 600
		}
	};

	textures = {
		get: vi.fn().mockReturnValue({
			add: vi.fn()
		})
	};

	anims = {
		create: vi.fn(),
		exists: vi.fn().mockReturnValue(false),
		remove: vi.fn()
	};

	cache = {
		audio: {
			remove: vi.fn()
		}
	};

	load = {
		audio: vi.fn(),
		spritesheet: vi.fn(),
		image: vi.fn(),
		once: vi.fn(),
		start: vi.fn()
	};

	time = {
		delayedCall: vi.fn(),
		removeAllEvents: vi.fn()
	};

	tweens = {
		add: vi.fn().mockReturnValue(new Tweens.Tween())
	};

	scale = {
		width: 800,
		height: 600
	};

	children = {
		getByName: vi.fn(),
		getAll: vi.fn().mockReturnValue([])
	};

	scene = {
		pause: vi.fn(),
		setVisible: vi.fn(),
		isPaused: vi.fn().mockReturnValue(false),
		resume: vi.fn(),
		launch: vi.fn(),
		restart: vi.fn()
	};

	sound = {
		add: vi.fn().mockReturnValue(new Sound.WebAudioSound()),
		get: vi.fn(),
		removeAll: vi.fn()
	};

	// Common Scene methods
	init() {}
	preload() {}
	create() {}
	update() {}
};

// Mock Phaser.Geom
const Geom = {
	Rectangle: class MockGeomRectangle {
		x: number;
		y: number;
		width: number;
		height: number;

		constructor(x = 0, y = 0, width = 0, height = 0) {
			this.x = x;
			this.y = y;
			this.width = width;
			this.height = height;
		}

		static Overlaps(rectA, rectB): boolean {
			// Simple overlap detection for testing
			return !(
				rectA.x + rectA.width < rectB.x ||
				rectB.x + rectB.width < rectA.x ||
				rectA.y + rectA.height < rectB.y ||
				rectB.y + rectB.height < rectA.y
			);
		}
	}
};

// Mock Phaser.Input
const Input = {
	Pointer: class MockPointer {
		x: number;
		y: number;
		leftButtonDown: ReturnType<typeof vi.fn>;
		rightButtonDown: ReturnType<typeof vi.fn>;

		constructor() {
			this.x = 0;
			this.y = 0;
			this.leftButtonDown = vi.fn().mockReturnValue(false);
			this.rightButtonDown = vi.fn().mockReturnValue(false);
		}
	}
};

// Mock global Phaser object
const Phaser = {
	GameObjects,
	Geom,
	Input,
	Sound,
	Tweens,
	Events,
	Scene,
	Math: {
		Clamp: (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)
	},
	AUTO: 0,
	CANVAS: 1,
	WEBGL: 2,
	Types: {
		Core: {
			GameConfig: {}
		}
	}
};

// Make Phaser available globally for tests
globalThis.Phaser = Phaser;

export { Scene, GameObjects, Sound, Tweens, Events, Geom, Input };
export default Phaser;
