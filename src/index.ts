import * as core from '@actions/core';
import { exec } from '@actions/exec';
import * as io from '@actions/io';
import * as toolCache from '@actions/tool-cache';
import * as os from 'os';
import * as path from 'path';
import * as semver from 'semver';
import * as git from './git';
import { selectVersion } from './versions';

async function winInstall(version: string, sha: string): Promise<void> {
    let toolDir = toolCache.find('xmake', version);
    if (!toolDir) {
        const installer = await core.group(`download xmake ${version}`, async () => {
            let url = "";
            if (version.startsWith("branch@")) {
                // we only use appveyor ci artifacts for branch version
                const arch = os.arch() === 'x64' ? 'x64' : 'x86';
                url = `https://ci.appveyor.com/api/projects/waruqi/xmake/artifacts/xmake-installer.exe?branch=${sha}&pr=false&job=Image%3A+Visual+Studio+2017%3B+Platform%3A+${arch}`;
            } else {
                // we cannot use appveyor ci artifacts, the old version links may be broken.
                const arch = os.arch() === 'x64' ? 'win64' : 'win32';
                url = semver.gt(version, '2.2.6')
                    ? `https://github.com/xmake-io/xmake/releases/download/v${version}/xmake-v${version}.${arch}.exe`
                    : `https://github.com/xmake-io/xmake/releases/download/v${version}/xmake-v${version}.exe`;
            }
            core.info(`downloading from ${url}`);
            const file = await toolCache.downloadTool(url);
            const exe = path.format({ ...path.parse(file), ext: '.exe', base: undefined });
            await io.mv(file, exe);
            core.info(`downloaded to ${exe}`);
            return exe;
        });
        toolDir = await core.group(`install xmake ${version}`, async () => {
            const binDir = path.join(os.tmpdir(), `xmake-${version}`);
            core.info(`installing to ${binDir}`);
            await exec(`"${installer}" /NOADMIN /S /D=${binDir}`);
            core.info(`installed to ${binDir}`);
            const cacheDir = await toolCache.cacheDir(binDir, 'xmake', version);
            await io.rmRF(binDir);
            await io.rmRF(installer);
            return cacheDir;
        });
    }
    core.addPath(toolDir);
}

async function unixInstall(version: string, sha: string): Promise<void> {
    let toolDir = toolCache.find('xmake', version);
    if (!toolDir) {
        const sourceDir = await core.group(`download xmake ${version}`, () => git.create(sha));
        toolDir = await core.group(`install xmake ${version}`, async () => {
            await exec('make', ['build'], { cwd: sourceDir });
            const binDir = path.join(os.tmpdir(), `xmake-${version}-${sha}`);
            await exec('make', ['install', `prefix=${binDir}`], { cwd: sourceDir });
            const cacheDir = await toolCache.cacheDir(binDir, 'xmake', version);
            await io.rmRF(binDir);
            await git.cleanup(sha);
            return cacheDir;
        });
    }
            
    // for versions 2.3.2 and above, xmake will be installed directly into the bin directory, and no script will be used to wrap it.
    if (version.startsWith("branch@") || semver.gt(version, '2.3.1')) {
        core.addPath(path.join(toolDir, 'bin'));
    } else {
        core.addPath(path.join(toolDir, 'share', 'xmake')); // only for <= 2.3.1
    }
}

async function run(): Promise<void> {
    try {
        const { version, sha } = await selectVersion();
        if (os.platform() === 'win32' || os.platform() === 'cygwin') await winInstall(version, sha);
        else await unixInstall(version, sha);
        await exec('xmake --version');
    } catch (error) {
        core.setFailed(error.message);
    }
}

run().catch(e => core.error(e));
