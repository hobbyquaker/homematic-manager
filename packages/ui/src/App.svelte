<script lang="ts">
    import type {Language} from '@homematic-manager/core';
    import {untrack} from 'svelte';

    import './app.css';

    import ConnectionIndicator from './lib/components/ConnectionIndicator.svelte';
    import LanguageSwitch from './lib/components/LanguageSwitch.svelte';
    import Loader from './lib/components/Loader.svelte';
    import MultiSelect from './lib/components/MultiSelect.svelte';
    import Notices from './lib/components/Notices.svelte';
    import RpcLogPanel from './lib/components/RpcLogPanel.svelte';
    import RpcProgress from './lib/components/RpcProgress.svelte';
    import Tabs from './lib/components/Tabs.svelte';
    import ThemeSwitch from './lib/components/ThemeSwitch.svelte';
    import UpdateNotice from './lib/components/UpdateNotice.svelte';
    import ToolbarButton from './lib/components/ToolbarButton.svelte';
    import {setStores} from './lib/stores/context.js';
    import type {TabId} from './lib/stores/routing.js';
    import type {Stores} from './lib/stores/Stores.svelte.js';
    import AboutDialog from './routes/AboutDialog.svelte';
    import ConfigDialog from './routes/ConfigDialog.svelte';
    import ConsolePage from './routes/ConsolePage.svelte';
    import DevicesPage from './routes/DevicesPage.svelte';
    import EventsPage from './routes/EventsPage.svelte';
    import LinksPage from './routes/LinksPage.svelte';
    import RadioPage from './routes/RadioPage.svelte';
    import ServiceMessagesPage from './routes/ServiceMessagesPage.svelte';

    interface Props {
        stores: Stores;
    }

    let {stores}: Props = $props();
    // The stores are created once by the host and handed in; they are not a changing prop, which
    // is exactly what `untrack` says here.
    setStores(untrack(() => stores));

    let aboutOpen = $state(false);

    const t = $derived(stores.i18n.t);
    const app = $derived(stores.app);

    const TAB_LABELS: Record<TabId, string> = {
        devices: 'Devices',
        links: 'Links',
        rssi: 'RSSI',
        console: 'RPC Console',
        messages: 'Service messages',
        events: 'Events',
    };

    /** The six tabs of 2.7 in its order, with the service-message count in brackets. */
    const tabs = $derived(
        stores.tabs.map((id) => ({
            id,
            label: t(TAB_LABELS[id]),
            ...(id === 'messages' ? {badge: stores.serviceMessages.countOf(app.selectedInterface)} : {}),
        })),
    );

    const interfaceOptions = $derived(app.configuredInterfaces.map((name) => ({value: name, label: name})));

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

    function setLanguage(language: Language): void {
        app.setLanguage(language);
        stores.i18n.language = language;
    }
</script>

<div class="hmm-app" data-testid="app">
    <header class="hmm-header">
        {#if interfaceOptions.length > 1}
            <MultiSelect
                options={interfaceOptions}
                selected={app.selectedInterface === '' ? [] : [app.selectedInterface]}
                multiple={false}
                label={t('Select an interface')}
                placeholder={t('Select an interface')}
                filterLabel={t('Filter')}
                testId="interface-select"
                onchange={(next) => void stores.selectInterface(next[0] ?? '')}
            />
        {/if}

        <Tabs {tabs} active={app.tab} label={t('Devices')} onselect={(id) => app.setTab(id as TabId)} />

        <ConnectionIndicator
            host={app.host}
            interfaces={stores.interfaces.states}
            backendConnected={app.connected}
            notConnectedText={t('Not connected')}
            notPresentText={t('Not present')}
            subscribingText={t('Subscribing')}
            testId="connection-indicator"
        />

        <div class="hmm-header-actions">
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
            <LanguageSwitch language={stores.i18n.language} label={t('Language')} onchange={setLanguage} />
            <ToolbarButton
                title={t('Settings')}
                icon="⚙"
                testId="settings-button"
                onclick={() => (app.configDialogOpen = true)}
            />
            <ToolbarButton title={t('Help')} icon="?" testId="about-button" onclick={() => (aboutOpen = true)} />
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
            {#if app.selectedInterface === ''}
                <p class="hmm-empty">{t('Select an interface')}</p>
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
        </div>
    </main>

    <RpcLogPanel
        bind:open={app.rpcLogOpen}
        entries={stores.writeLog.newestFirst}
        pending={stores.writeLog.pending}
        title={t('RPC log')}
        emptyText={t('No RPC calls yet')}
        pendingText={t('in progress')}
        clearLabel={t('Clear')}
        closeLabel={t('Close')}
        testId="rpclog"
        onclear={() => void stores.writeLog.clear()}
    />

    <Notices
        notices={stores.notices.items}
        dismissLabel={t('Dismiss')}
        testId="notices"
        ondismiss={(id) => stores.notices.dismiss(id)}
    />

    <RpcProgress
        progress={stores.writeLog.progress}
        title={t('RPC execution')}
        cancelLabel={t('Cancel')}
        testId="rpc-progress"
        oncancel={() => void stores.writeLog.cancel()}
    />
    <ConfigDialog bind:open={app.configDialogOpen} />
    <AboutDialog bind:open={aboutOpen} />
    <Loader visible={app.loading} text={t('Loading Homematic Manager...')} testId="loader" />
</div>

<style>
    .hmm-app {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        position: relative;
        background: var(--hmm-bg);
        color: var(--hmm-fg);
    }

    .hmm-header {
        display: flex;
        align-items: center;
        gap: 8px;
        height: var(--hmm-header-height);
        padding: 0 6px;
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

    .hmm-main {
        flex: 1 1 auto;
        min-height: 0;
        padding: 8px;
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
