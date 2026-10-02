import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    buildDesktopExecCommand,
    buildShortcutFileName,
    createAppShortcut,
    decodeLaunchAppPayload,
    encodeLaunchAppPayload,
} from "./shortcuts";

const testApp = {
    Name: `Paint "Pro"`,
    Path: `C:\\Program Files\\Paint Pro\\paint.exe`,
    Args: `--profile "Default"`,
    Icon: "",
    Source: "startmenu",
};

const tmpDirs: string[] = [];

afterEach(() => {
    while (tmpDirs.length > 0) {
        const dir = tmpDirs.pop()!;
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

describe("shortcuts", () => {
    it("builds shortcut file names safely", () => {
        const filename = buildShortcutFileName(`My/App:*?<>|"Name`);
        assert.equal(filename, "MyAppName");
    });

    it("quotes executable path in desktop command", () => {
        const command = buildDesktopExecCommand("/opt/Win Boat/winboat", `abc"123`);
        assert.equal(command, `"/opt/Win Boat/winboat" --launch-app-payload "abc\\"123"`);
    });

    it("encodes and decodes launch payload", () => {
        const payload = encodeLaunchAppPayload(testApp);
        const decoded = decodeLaunchAppPayload(payload);
        assert.deepEqual(decoded, {
            Name: testApp.Name,
            Path: testApp.Path,
            Args: testApp.Args,
            Source: testApp.Source,
        });
    });

    it("returns already_exists for identical shortcut content", () => {
        const shortcutDir = fs.mkdtempSync(path.join(os.tmpdir(), "winboat-shortcuts-"));
        tmpDirs.push(shortcutDir);

        const first = createAppShortcut({
            app: testApp,
            destination: "desktop",
            destinationDir: shortcutDir,
            executablePath: "/usr/bin/winboat",
        });
        assert.equal(first.status, "created");

        const second = createAppShortcut({
            app: testApp,
            destination: "desktop",
            destinationDir: shortcutDir,
            executablePath: "/usr/bin/winboat",
        });
        assert.equal(second.status, "already_exists");
    });

    it("returns conflict for changed content unless overwrite is enabled", () => {
        const shortcutDir = fs.mkdtempSync(path.join(os.tmpdir(), "winboat-shortcuts-"));
        tmpDirs.push(shortcutDir);

        const first = createAppShortcut({
            app: testApp,
            destination: "desktop",
            destinationDir: shortcutDir,
            executablePath: "/usr/bin/winboat",
        });
        assert.equal(first.status, "created");

        const conflict = createAppShortcut({
            app: testApp,
            destination: "desktop",
            destinationDir: shortcutDir,
            executablePath: "/opt/other/winboat",
        });
        assert.equal(conflict.status, "conflict");

        const updated = createAppShortcut({
            app: testApp,
            destination: "desktop",
            destinationDir: shortcutDir,
            executablePath: "/opt/other/winboat",
            overwrite: true,
        });
        assert.equal(updated.status, "updated");
    });
});
