<script lang="ts">
    import {untrack} from 'svelte';

    import type {RpcLogEntry} from '@homematic-manager/core';

    import './app.css';

    import {setDataTableEnvironment} from './lib/components/dataTableContext.js';
    import GithubLink from './lib/components/GithubLink.svelte';
    import InterfacePopup from './lib/components/InterfacePopup.svelte';
    import type {StoreEntry} from './lib/components/interfacePopup.js';
    import Loader from './lib/components/Loader.svelte';
    import {metaMark, metaTitle} from './lib/components/metaIndicator.js';
    import Notices from './lib/components/Notices.svelte';
    import RpcLogPanel from './lib/components/RpcLogPanel.svelte';
    import RpcProgress from './lib/components/RpcProgress.svelte';
    import Tabs from './lib/components/Tabs.svelte';
    import ThemeSwitch from './lib/components/ThemeSwitch.svelte';
    import UpdateNotice from './lib/components/UpdateNotice.svelte';
    import ToolbarButton from './lib/components/ToolbarButton.svelte';
    import {setStores} from './lib/stores/context.js';
    import {STORE_INTERFACE, type TabId} from './lib/stores/routing.js';
    import type {Stores} from './lib/stores/Stores.svelte.js';
    import ChangeSetDialog from './routes/ChangeSetDialog.svelte';
    import ConfigDialog from './routes/ConfigDialog.svelte';
    import ConsolePage from './routes/ConsolePage.svelte';
    import DevicesPage from './routes/DevicesPage.svelte';
    import EventsPage from './routes/EventsPage.svelte';
    import LinksPage from './routes/LinksPage.svelte';
    import MetadataPage from './routes/MetadataPage.svelte';
    import RadioPage from './routes/RadioPage.svelte';
    import ServiceMessagesPage from './routes/ServiceMessagesPage.svelte';

    /** The project page, opened by the header's GitHub icon (task 23). */
    const PROJECT_URL = 'https://github.com/hobbyquaker/homematic-manager';

    interface Props {
        stores: Stores;
    }

    let {stores}: Props = $props();
    // The stores are created once by the host and handed in; they are not a changing prop, which
    // is exactly what `untrack` says here.
    setStores(untrack(() => stores));
    // Task 40: every grid's column widths and the words of its header menu, set once for all of them.
    setDataTableEnvironment({
        columnWidths: untrack(() => stores.app.columnWidths),
        t: (key, params) => stores.i18n.t(key, params),
    });

    let changeSetOpen = $state(false);

    const t = $derived(stores.i18n.t);
    const app = $derived(stores.app);

    /**
     * Task 48: "open in console" on an RPC log entry. The console page picks the call up when it
     * is shown for that interface, so the interface and the tab are switched here and the drawer
     * stays as it is - the user is going to send the call and look at the log again.
     */
    function openInConsole(entry: RpcLogEntry): void {
        stores.console.recall(entry);
        if (app.selectedInterface !== entry.interfaceName) {
            app.setInterface(entry.interfaceName);
        }
        app.setTab('console');
    }

    /** The provider names of the store's entry in the picker; `t` is reactive, so these are functions. */
    const META_PROVIDER_LABELS: Record<'local' | 'occulite' | 'rega', () => string> = {
        local: () => t('This profile'),
        // The names of the programs, not of the products they are part of (the maintainer,
        // 2026-09-10): the store behind an openccu-lite is `occulited`, the one of a CCU is ReGaHSS.
        occulite: () => 'occulited',
        rega: () => 'ReGaHSS',
    };

    const TAB_LABELS: Record<TabId, string> = {
        devices: 'Devices',
        links: 'Links',
        rssi: 'RSSI',
        console: 'RPC Console',
        messages: 'Service messages',
        events: 'Events',
        // the store's own tabs (2026-09-10): two lists on ReGaHSS, one tree on occulited
        rooms: 'Rooms',
        functions: 'Functions',
        metadata: 'Metadata',
    };

    /**
     * The metadata store as an entry of the interface picker (the maintainer, 2026-09-10: "mach
     * ReGaHSS doch zu einem eigenen interface"). Absent where there is no store; shown but not
     * selectable while it does not answer, with the reason in its title.
     */
    const storeEntry = $derived.by((): StoreEntry | undefined => {
        const state = stores.taxonomy.state;
        if (state === undefined) {
            return undefined;
        }
        const label = META_PROVIDER_LABELS[state.provider]();
        return {
            id: STORE_INTERFACE,
            label,
            mark: metaMark(state),
            title: metaTitle(state, {
                label,
                reachable: t('Reachable'),
                unreachable: t('Unreachable'),
                readOnly: t('Read-only'),
                writable: t('Writable'),
                detail: (entry) =>
                    t('revision {revision}, {count} objects', {revision: entry.revision, count: entry.objects}),
            }),
            selectable: state.reachable,
            provider: state.provider,
        };
    });

    /** The six tabs of 2.7 in its order, with the service-message count in brackets. */
    const tabs = $derived(
        stores.tabs.map((id) => ({
            id,
            label: t(TAB_LABELS[id]),
            ...(id === 'messages' ? {badge: stores.serviceMessages.countOf(app.selectedInterface)} : {}),
        })),
    );

    /**
     * What the popup puts under an interface name beyond its own state (task 21).
     *
     * Both halves are only there once something has read them: the device count as soon as the
     * Devices tab of that interface has been open, the duty cycle once the gateway list has been
     * read - by the Radio tab, or by the device grid of BidCos-RF for the receiver names (BUGS.md
     * B-2). Neither is fetched for the popup - an interface list that starts five sweeps when it
     * is opened would be a worse popup than one that says a little less.
     */
    const interfaceDetails = $derived(
        Object.fromEntries(
            stores.interfaces.states.map((state) => {
                const index = stores.devices.index(state.name);
                const cycles = stores.radio
                    .gateways(state.name)
                    .map((gateway) => gateway.DUTY_CYCLE)
                    .filter((value): value is number => typeof value === 'number');
                return [
                    state.name,
                    {
                        ...(index === undefined ? {} : {devices: index.devices().length}),
                        ...(cycles.length === 0 ? {} : {dutyCycle: Math.max(...cycles)}),
                    },
                ];
            }),
        ),
    );

    $effect(() => {
        document.documentElement.lang = stores.i18n.language;
    });

    $effect(() => {
        const root = document.documentElement;
        if (app.theme === 'system') {
            root.removeAttribute('data-theme');
        } else {
            root.setAttribute('data-theme', app.theme);
        }
        // The host paints the window chrome and the native menus; it has to follow the same choice
        // (D-22). Without a host this resolves and does nothing.
        void stores.host.setTheme(app.theme);
    });

    /** The application menu cannot reach into the page, so it asks (task 11's `menu.action`). */
    $effect(() =>
        // `MenuAction` has exactly one member today, so there is nothing to distinguish; adding a
        // second one makes the compiler ask for the switch back.
        stores.host.onMenuAction(() => {
            app.configDialogOpen = true;
        }),
    );
</script>

<div class="hmm-app" data-testid="app">
    <header class="hmm-header">
        <!--
            Task 21: one control for the interface and for the state of the CCU. It is here even
            when a system has a single interface - it is what says whether that interface answers.
        -->
        <InterfacePopup
            interfaces={stores.interfaces.states}
            selected={app.selectedInterface}
            host={app.host}
            backendConnected={app.connected}
            details={interfaceDetails}
            label={t('Select an interface')}
            listLabel={t('Interfaces')}
            connectedText={t('Connected')}
            notConnectedText={t('Not connected')}
            notPresentText={t('Not present')}
            notAnsweringText={t('Not answering')}
            retryText={t('Retry now')}
            onretry={(names) => {
                for (const name of names) {
                    void stores.interfaces.reconnect(name);
                }
            }}
            subscribingText={t('Subscribing')}
            allConnectedText={t('All interfaces are connected')}
            someNotConnectedText={t('Not every interface is connected')}
            portLabel={t('Port')}
            devicesLabel={(count) => t('{count} devices', {count}, count)}
            dutyCycleLabel={(value) => t('Duty cycle {value} %', {value})}
            publishCallbackPorts={app.config?.publishCallbackPorts === true}
            callbackPortInUseLabel={(port) => t('Callback port {port} is in use', {port: String(port)})}
            callbackPortFailedLabel={(port) => t('Callback port {port} cannot be opened', {port: String(port)})}
            publishPortText={t('Publish this port unchanged')}
            testId="interface-select"
            onselect={(name) => void stores.selectInterface(name)}
            store={storeEntry}
            storeTestId="meta-indicator"
        />

        <Tabs {tabs} active={app.tab} label={t('Devices')} onselect={(id) => app.setTab(id as TabId)} />

        <div class="hmm-header-actions">
            {#if app.session}
                <!--
                    D-32: only the CCU addon with `--auth-mode rega` ever has a session, and only
                    then are these two here at all. The link is relative to the page's own
                    directory, exactly like the API socket, so it works at `/` and under
                    `/addons/hmm/` without knowing either.
                -->
                <span
                    class="hmm-header-user"
                    data-testid="session-user"
                    title={t('Logged in as {user}', {user: app.session.user})}>{app.session.user}</span
                >
                <a class="hmm-header-logout" href="logout" data-testid="session-logout">{t('Log out')}</a>
            {/if}
            {#if stores.changeSet.count > 0}
                <!--
                    Issue #124: the staged changes are only useful if it is impossible to forget
                    them, so the button only exists while something is staged and says how much.
                -->
                <button
                    type="button"
                    class="hmm-button hmm-header-changes"
                    data-testid="change-set-open"
                    onclick={() => (changeSetOpen = true)}>{t('Pending changes')} ({stores.changeSet.count})</button
                >
            {/if}
            <ToolbarButton
                title={t('RPC log')}
                icon="≣"
                pressed={app.rpcLogOpen}
                testId="rpclog-toggle"
                onclick={() => (app.rpcLogOpen = !app.rpcLogOpen)}
            />
            <ThemeSwitch
                theme={app.theme}
                labelFor={(theme) => t(`Theme: ${theme}`)}
                testId="theme-switch"
                onclick={() => app.cycleTheme()}
            />
            <!--
                D-36, task 22: the language switch is not here any more. It is a setting a user
                touches once, and it sits in the settings dialog with the rest of them; the header
                keeps the two controls that are switched while working - the RPC log and the theme.
            -->
            <ToolbarButton
                title={t('Settings')}
                icon="⚙"
                testId="settings-button"
                onclick={() => (app.configDialogOpen = true)}
            />
            <!--
                Task 23: the "?" menu and its About dialog are gone. What the dialog was consulted
                for - version, device data, licence - is the info line at the foot of the settings
                dialog; what is left is the way to the project, and that is one link. In Electron
                the click goes through the host bridge to `shell.openExternal` in main, which has
                an allow-list of exactly this URL; everywhere else it is the link the browser
                already knows what to do with.
            -->
            <GithubLink
                href={PROJECT_URL}
                label={t('Homematic Manager on GitHub')}
                openExternal={(url) => stores.host.openExternal(url)}
                testId="github-link"
            />
        </div>
    </header>

    <UpdateNotice
        state={stores.host.updateNotice}
        labels={{
            available: t('A new version is available'),
            downloading: t('Downloading'),
            downloaded: t('The update is ready and will be installed when you quit'),
            installOnQuit: t('The update will be installed when you quit'),
            download: t('Download'),
            install: t('Install on quit'),
            dismiss: t('Dismiss'),
        }}
        testId="update-notice"
        ondownload={() => void stores.host.downloadUpdate()}
        oninstall={() => void stores.host.installUpdateOnQuit()}
        ondismiss={() => void stores.host.dismissUpdate()}
    />

    <main class="hmm-main">
        <div class="hmm-panel" id={`panel-${app.tab}`} role="tabpanel" aria-labelledby={`tab-${app.tab}`}>
            <!--
                #143: one bad value used to take the whole page with it. A description whose
                `PARAMSETS` was a string instead of a list threw inside the grid's reactivity, and
                what a user saw was a page stuck on "Loading Homematic Manager..." - with the device
                count beside it saying 31, because that came from another derived. The value is
                shaped in the backend now, but the class of fault stays possible: a boundary turns
                it into a message with the reason, one tab wide, instead of a blank page. The key
                is the tab and the interface, so switching either one tries again.
            -->
            {#key `${app.selectedInterface}/${app.tab}`}
                <svelte:boundary onerror={(error) => stores.notices.fromError(error, `page ${app.tab}`)}>
                    {#snippet failed(error, reset)}
                        <div class="hmm-page-failed" data-testid="page-failed">
                            <p>{t('This tab could not be drawn.')}</p>
                            <p class="hmm-page-failed-reason">
                                {error instanceof Error ? error.message : String(error)}
                            </p>
                            <button type="button" class="hmm-button" onclick={reset}>{t('Try again')}</button>
                        </div>
                    {/snippet}
                    {#if app.selectedInterface === ''}
                        <p class="hmm-empty">{t('Select an interface')}</p>
                    {:else if app.storeSelected}
                        <!--
                    2026-09-10: the store is the selection. ReGaHSS has its two lists as two
                    tabs; every store that nests has the one tree, which is also what a flat store
                    gets when the hash names a tab it does not have.
                -->
                        {#if app.tab === 'rooms'}
                            <MetadataPage enumId="room" />
                        {:else if app.tab === 'functions'}
                            <MetadataPage enumId="function" />
                        {:else}
                            <MetadataPage />
                        {/if}
                    {:else if app.tab === 'devices'}
                        <DevicesPage />
                    {:else if app.tab === 'links'}
                        <LinksPage />
                    {:else if app.tab === 'rssi'}
                        <RadioPage />
                    {:else if app.tab === 'console'}
                        <ConsolePage />
                    {:else if app.tab === 'messages'}
                        <ServiceMessagesPage />
                    {:else}
                        <EventsPage />
                    {/if}
                </svelte:boundary>
            {/key}
        </div>
    </main>

    <RpcLogPanel
        bind:open={app.rpcLogOpen}
        entries={stores.rpcLog.visible}
        pending={stores.rpcLog.pending}
        bind:hideBackground={stores.rpcLog.hideBackground}
        title={t('RPC log')}
        emptyText={t('No RPC calls yet')}
        pendingText={t('in progress')}
        clearLabel={t('Clear')}
        closeLabel={t('Close')}
        resizeLabel={t('Resize the RPC log')}
        hideBackgroundLabel={t('Hide background calls')}
        openLabel={t('Open in console')}
        originLabels={{console: t('Origin: console'), ui: t('Origin: UI'), background: t('Origin: background')}}
        testId="rpclog"
        onclear={() => void stores.rpcLog.clear()}
        onopen={openInConsole}
    />

    <Notices
        notices={stores.notices.items}
        dismissLabel={t('Dismiss')}
        moreLabel={(count) => t('{count} more', {}, count)}
        lessLabel={t('Show fewer')}
        testId="notices"
        ondismiss={(id) => stores.notices.dismiss(id)}
    />

    <RpcProgress
        progress={stores.rpcLog.progress}
        title={t('RPC execution')}
        cancelLabel={t('Cancel')}
        testId="rpc-progress"
        oncancel={() => void stores.rpcLog.cancel()}
    />
    <ConfigDialog bind:open={app.configDialogOpen} />
    <ChangeSetDialog bind:open={changeSetOpen} />
    <Loader visible={app.loading} text={t('Loading Homematic Manager...')} testId="loader" />
</div>

<style>
    /* #143: what a tab that threw looks like - a sentence, the reason, and a way to try again. */
    .hmm-page-failed {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 8px;
        padding: 16px;
    }

    .hmm-page-failed-reason {
        color: var(--hmm-error);
        font-family: var(--hmm-font-mono);
    }

    /*
        The shell is the window, and it says so itself.

        `height: 100%` was a promise the mount element had to keep, and when it did not - a host
        that mounts somewhere else, a stylesheet that loads late - the height fell back to `auto`,
        the tables stopped being bounded and grew with their rows: the page scrolled and the header
        scrolled off the top of it (maintainer, 2026-09-06, on the Events and Devices tabs). `dvh`
        depends on nothing above this element, so there is no ancestor left to get it wrong; `#app`
        in app.css keeps its own height as well, and the two agree.
    */
    .hmm-app {
        display: flex;
        flex-direction: column;
        height: 100dvh;
        max-height: 100dvh;
        min-height: 0;
        overflow: hidden;
        position: relative;
        background: var(--hmm-bg);
        color: var(--hmm-fg);
    }

    /* D-34: one flat bar with a hairline under it, not a gradient with a blue frame. */
    .hmm-header {
        display: flex;
        align-items: center;
        gap: 8px;
        height: var(--hmm-header-height);
        padding: 0 10px;
        background: var(--hmm-header-bg);
        border-bottom: 1px solid var(--hmm-border);
        flex: 0 0 auto;
    }

    .hmm-header-actions {
        display: flex;
        align-items: center;
        gap: 4px;
        margin-left: auto;
    }

    .hmm-header-user {
        color: var(--hmm-fg-muted);
        max-width: 12em;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .hmm-header-logout {
        color: var(--hmm-link);
        margin-right: 4px;
    }

    .hmm-main {
        flex: 1 1 auto;
        min-height: 0;
        padding: 10px;
        overflow: hidden;
    }

    .hmm-panel {
        height: 100%;
        min-height: 0;
    }

    .hmm-empty {
        color: var(--hmm-fg-muted);
    }
</style>
