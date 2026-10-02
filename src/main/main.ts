import { app, BrowserWindow, ipcMain, session, dialog } from "electron";
import { join } from "path";
import { initialize, enable } from "@electron/remote/main/index.js";
import Store from "electron-store";

initialize();

// Window Constants
const WINDOW_MIN_WIDTH = 1280;
const WINDOW_MIN_HEIGHT = 800;

// For electron-store Type-Safety
type SchemaType = {
    dimensions: {
        width: number;
        height: number;
    };
    position: {
        x: number;
        y: number;
    };
};

const windowStore = new Store<SchemaType>({
    schema: {
        dimensions: {
            type: "object",
            properties: {
                width: {
                    type: "number",
                    default: WINDOW_MIN_WIDTH,
                },
                height: {
                    type: "number",
                    default: WINDOW_MIN_HEIGHT,
                },
            },
            required: ["width", "height"],
        },
        position: {
            type: "object",
            properties: {
                x: {
                    type: "number",
                },
                y: {
                    type: "number",
                },
            },
            required: ["x", "y"],
        },
    },
});

let mainWindow: BrowserWindow | null = null;
const SHORTCUT_LAUNCH_ARG = "--launch-app-payload";
let pendingShortcutPayload: string | null = parseShortcutPayload(process.argv);

function createWindow() {
    if (!app.requestSingleInstanceLock()) {
        // @ts-ignore property "window" is optional, see: [dialog.showMessageBoxSync](https://www.electronjs.org/docs/latest/api/dialog#dialogshowmessageboxsyncwindow-options)
        dialog.showMessageBoxSync(null, {
            type: "error",
            buttons: ["Close"],
            title: "WinBoat",
            message: "An instance of WinBoat is already running.\n\tMultiple Instances are not allowed.",
        });
        app.exit();
    }

    mainWindow = new BrowserWindow({
        minWidth: WINDOW_MIN_WIDTH,
        minHeight: WINDOW_MIN_HEIGHT,
        width: windowStore.get("dimensions.width"),
        height: windowStore.get("dimensions.height"),
        x: windowStore.get("position.x"),
        y: windowStore.get("position.y"),
        transparent: false,
        frame: false,
        webPreferences: {
            // preload: join(__dirname, 'preload.js'),
            nodeIntegration: true,
            contextIsolation: false,
        },
    });

    mainWindow.on("close", () => {
        const bounds = mainWindow?.getBounds();

        windowStore.set("dimensions", {
            width: bounds?.width,
            height: bounds?.height,
        });

        windowStore.set("position", {
            x: bounds?.x,
            y: bounds?.y,
        });
    });

    enable(mainWindow.webContents);
    mainWindow.webContents.on("did-finish-load", () => {
        if (pendingShortcutPayload) {
            mainWindow?.webContents.send("shortcut-launch-request", pendingShortcutPayload);
        }
    });

    if (process.env.NODE_ENV === "development") {
        const rendererPort = process.argv[2];
        mainWindow.loadURL(`http://localhost:${rendererPort}`);
    } else {
        mainWindow.loadFile(join(app.getAppPath(), "renderer", "index.html"));
    }
}

app.whenReady().then(() => {
    createWindow();

    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                // 'Content-Security-Policy': ['script-src \'self\'']
                "Content-Security-Policy": [
                    "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' 'unsafe-inline'",
                    "worker-src 'self' blob:",
                    "media-src 'self' blob:",
                    "font-src 'self' 'unsafe-inline' https://fonts.gstatic.com;",
                    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
                ],
            },
        });
    });

    app.on("activate", function () {
        // On macOS it's common to re-create a window in the app when the
        // dock icon is clicked and there are no other windows open.
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on("window-all-closed", function () {
    if (process.platform !== "darwin") app.quit();
});

app.on("second-instance", (_event, argv) => {
    if (mainWindow) {
        const secondInstancePayload = parseShortcutPayload(argv);
        if (secondInstancePayload) {
            pendingShortcutPayload = secondInstancePayload;
            mainWindow.webContents.send("shortcut-launch-request", pendingShortcutPayload);
        }
        mainWindow.focus();
    }
});

ipcMain.on("message", (_event, message) => {
    console.log(message);
});

ipcMain.on("shortcut-launch-ready", _event => {
    if (!pendingShortcutPayload) return;
    mainWindow?.webContents.send("shortcut-launch-request", pendingShortcutPayload);
});

function parseShortcutPayload(argv: string[]) {
    const payloadIndex = argv.findIndex(arg => arg === SHORTCUT_LAUNCH_ARG);
    if (payloadIndex !== -1) {
        if (payloadIndex >= argv.length - 1) {
            return null;
        }
        return argv[payloadIndex + 1];
    }

    const prefixedArg = argv.find(arg => arg.startsWith(`${SHORTCUT_LAUNCH_ARG}=`));
    if (!prefixedArg) {
        return null;
    }
    return prefixedArg.slice(`${SHORTCUT_LAUNCH_ARG}=`.length);
}
