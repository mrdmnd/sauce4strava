/* global browser, sauce */

import * as hist from '/src/bg/hist.mjs';

sauce.ns('hist', () => Object.fromEntries(Object.entries(hist))); // For console debugging only.

// Sadly 'onInstalled' callbacks are not reliable on Safari so we need
// to try migrations every startup.
const migrationsRun = sauce.migrate.runMigrations();
self.currentUser = Number(localStorage.getItem('currentUser')) || undefined;


function setCurrentUser(id) {
    if (id != null) {
        console.info("Current user updated:", id);
        localStorage.setItem('currentUser', id);
    } else {
        console.warn("Current user logged out");
        localStorage.removeItem('currentUser');
    }
    self.currentUser = id;
    const ev = new Event('currentUserUpdate');
    ev.id = id;
    self.dispatchEvent(ev);
}


async function maybeStartSyncManager() {
    await migrationsRun;
    if (self.currentUser && !hist.hasSyncManager()) {
        hist.startSyncManager(self.currentUser);
    }
}


(function monkeyPatchSetTimeout() {
    // Make setTimeout suspend safe.  Internally the clock for a site does not increment
    // during OS power save modes.  Timeouts spanning such a suspend event will eventually
    // run but without consideration for wall clock changes.  We prefer wall clock for everything
    // so we modify the behavior globally to use a setInterval wake loop to resume timeouts
    // affected by this.
    const setTimeoutSave = self.setTimeout;
    const clearTimeoutSave = self.clearTimeout;
    const _timeoutsQ = [];
    const _timeoutsH = {};
    let wakeLoopId;

    function wakeLoop() {
        const now = Date.now();
        let i = _timeoutsQ.length;
        while (i && _timeoutsQ[i - 1].ts < now) {
            const entry = _timeoutsQ[--i];
            if (!entry.complete && !entry.cleared) {
                clearTimeoutSave(entry.id);
                setTimeoutSave(entry.callback, 0, ...entry.args);
            }
            delete _timeoutsH[entry.id];
        }
        _timeoutsQ.length = i;
        if (!i) {
            clearInterval(wakeLoopId);
            wakeLoopId = null;
        }
    }

    self.setTimeout = function suspendSafeSetTimeout(callback, ms, ...args) {
        const entry = {ts: Date.now() + ms, callback, args};
        entry.id = setTimeoutSave(() => {
            entry.complete = true;
            callback(...args);
        }, ms);
        _timeoutsQ.push(entry);
        _timeoutsQ.sort((a, b) => b.ts - a.ts);
        _timeoutsH[entry.id] = entry;
        if (wakeLoopId == null && (_timeoutsQ.length > 100 || ms > 1000)) {
            wakeLoopId = setInterval(wakeLoop, 1000);
        }
        if (ms > 60000) {
            // This will reload the entire page if we were unloaded.
            const when = Math.round(Date.now() + ms);
            browser.alarms.create(`SetTimeoutBackup-${when}`, {when});
        }
        return entry.id;
    };

    self.clearTimeout = function suspendSafeClearTimeout(id) {
        const entry = _timeoutsH[id];
        if (entry) {
            entry.cleared = true;
        }
        clearTimeoutSave(id);
    };
})();

if (browser.runtime.getURL('').startsWith('safari-web-extension:')) {
    // Workaround for visibiltyState = 'prerender' causing GA to pause until unload
    Object.defineProperty(document, 'visibilityState', {value: 'hidden'});
    document.dispatchEvent(new Event('visibilitychange'));
}

// Required to make site start with alarms API
browser.alarms.onAlarm.addListener(() =>
    void maybeStartSyncManager().catch(sauce.report.error)); // pur pot hack. :/

browser.runtime.onInstalled.addListener(async details => {
    if (['install', 'update'].includes(details.reason) && !details.temporary) {
        const version = browser.runtime.getManifest().version;
        sauce.report.event('ExtensionLifecycle', details.reason,
            details.previousVersion ? `${details.previousVersion} -> ${version}` : version,
            {nonInteraction: true, page: location.pathname});  // bg okay
        if (details.previousVersion && version !== details.previousVersion) {
            await sauce.storage.set('recentUpdate', {previousVersion: details.previousVersion, version});
        }
    }
});

browser.runtime.onMessage.addListener(async msg => {
    if (msg && msg.source === 'ext/boot') {
        if (msg.op === 'setCurrentUser') {
            const id = msg.currentUser || undefined;
            if (self.currentUser !== id) {
                setCurrentUser(id);
            }
        }
    }
});

if (browser.declarativeContent) {
    // Chromium...
    browser.runtime.onInstalled.addListener(async details => {
        browser.declarativeContent.onPageChanged.removeRules(undefined, () => {
            browser.declarativeContent.onPageChanged.addRules([{
                actions: [new browser.declarativeContent.ShowPageAction()],
                conditions: [new browser.declarativeContent.PageStateMatcher({
                    pageUrl: {
                        hostSuffix: 'www.strava.com',
                        schemes: ['https']
                    }
                })],
            }]);
        });
    });
} else {
    // Firefox, Safari, etc...
    const showing = new Set();
    browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        const url = new URL(tab.url);
        if (url.origin.match(/^https:\/\/www\.strava\.com$/i)) {
            browser.pageAction.show(tabId);
            showing.add(tabId);
        } else if (showing.has(tabId)) {
            browser.pageAction.hide(tabId);
            showing.delete(tabId);
        }
    });
}

maybeStartSyncManager().catch(sauce.report.error);
