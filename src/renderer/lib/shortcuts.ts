const childProcess: typeof import("node:child_process") = require("node:child_process");
const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const process: typeof import("node:process") = require("node:process");

export type ShortcutDestination = "desktop" | "applications";

export type ShortcutApp = {
    Name: string;
    Path: string;
    Args: string;
    Icon: string;
    Source: string;
};

export type ShortcutStatus = "created" | "updated" | "already_exists" | "conflict";

export type ShortcutResult = {
    status: ShortcutStatus;
    filePath: string;
};

export type CreateShortcutOptions = {
    app: ShortcutApp;
    destination: ShortcutDestination;
    overwrite?: boolean;
    destinationDir?: string;
    executablePath?: string;
};

export function encodeLaunchAppPayload(app: ShortcutApp): string {
    return Buffer.from(
        JSON.stringify({
            Name: app.Name,
            Path: app.Path,
            Args: app.Args || "",
            Source: app.Source,
        }),
        "utf-8",
    ).toString("base64url");
}

export function decodeLaunchAppPayload(payload: string): Pick<ShortcutApp, "Name" | "Path" | "Args" | "Source"> | null {
    try {
        const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
        if (
            typeof parsed?.Name !== "string" ||
            typeof parsed?.Path !== "string" ||
            typeof parsed?.Args !== "string" ||
            typeof parsed?.Source !== "string"
        ) {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

export function getWinboatExecutablePath() {
    return process.env.APPIMAGE || process.execPath;
}

export function buildDesktopExecCommand(executablePath: string, payload: string) {
    return `${quoteDesktopEntryValue(executablePath)} --launch-app-payload ${quoteDesktopEntryValue(payload)}`;
}

export function buildShortcutFileName(appName: string) {
    const sanitized = appName
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
        .replace(/\s+/g, " ")
        .trim();
    return (sanitized || "WinBoat App").slice(0, 120);
}

export function resolveShortcutDirectory(destination: ShortcutDestination) {
    if (process.platform !== "linux") {
        throw new Error("Shortcut creation is only supported on Linux");
    }

    if (destination === "applications") {
        return process.env.XDG_DATA_HOME
            ? path.join(process.env.XDG_DATA_HOME, "applications")
            : path.join(os.homedir(), ".local", "share", "applications");
    }

    return resolveDesktopDirectory();
}

export function createDesktopEntryContent(appName: string, execCommand: string) {
    return [
        "[Desktop Entry]",
        "Type=Application",
        "Version=1.0",
        `Name=${escapeDesktopTextValue(appName)}`,
        "Comment=Launch Windows app via WinBoat",
        `Exec=${execCommand}`,
        "Terminal=false",
        "StartupNotify=true",
        "Categories=Utility;",
        "",
    ].join("\n");
}

export function createAppShortcut(options: CreateShortcutOptions): ShortcutResult {
    const destinationDir = options.destinationDir || resolveShortcutDirectory(options.destination);
    const shortcutPath = path.join(destinationDir, `${buildShortcutFileName(options.app.Name)}.desktop`);
    const payload = encodeLaunchAppPayload(options.app);
    const execCommand = buildDesktopExecCommand(options.executablePath || getWinboatExecutablePath(), payload);
    const content = createDesktopEntryContent(options.app.Name, execCommand);
    const existedBefore = fs.existsSync(shortcutPath);

    fs.mkdirSync(destinationDir, { recursive: true });

    if (existedBefore) {
        const existing = fs.readFileSync(shortcutPath, "utf-8");
        if (existing === content) {
            return { status: "already_exists", filePath: shortcutPath };
        }
        if (!options.overwrite) {
            return { status: "conflict", filePath: shortcutPath };
        }
    }

    fs.writeFileSync(shortcutPath, content, { mode: 0o755 });
    fs.chmodSync(shortcutPath, 0o755);

    return {
        status: existedBefore ? "updated" : "created",
        filePath: shortcutPath,
    };
}

function resolveDesktopDirectory() {
    const fromCommand = resolveDesktopDirectoryFromCommand();
    if (fromCommand) {
        return fromCommand;
    }

    const userDirsPath = path.join(os.homedir(), ".config", "user-dirs.dirs");
    if (fs.existsSync(userDirsPath)) {
        const config = fs.readFileSync(userDirsPath, "utf-8");
        const fromConfig = parseXdgDirectory(config, "XDG_DESKTOP_DIR");
        if (fromConfig) {
            return fromConfig;
        }
    }

    return path.join(os.homedir(), "Desktop");
}

function resolveDesktopDirectoryFromCommand() {
    try {
        const commandOutput = childProcess.execFileSync("xdg-user-dir", ["DESKTOP"], { encoding: "utf-8" }).trim();
        return commandOutput || null;
    } catch {
        return null;
    }
}

function parseXdgDirectory(fileContent: string, key: string) {
    for (const line of fileContent.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith(`${key}=`)) continue;
        const rawValue = trimmed.slice(`${key}=`.length).trim().replace(/^"/, "").replace(/"$/, "");
        if (!rawValue) return null;
        return rawValue.replace("$HOME", os.homedir()).replace("${HOME}", os.homedir());
    }
    return null;
}

function quoteDesktopEntryValue(value: string) {
    return `"${value.replaceAll("\\", "\\\\").replaceAll(`"`, `\\"`)}"`;
}

function escapeDesktopTextValue(value: string) {
    return value.replaceAll("\n", " ").trim();
}
