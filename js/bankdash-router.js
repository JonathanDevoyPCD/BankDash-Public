(function () {
    const views = {
        overview: {
            label: 'Overview',
            targets: [
                'availableNow',
                'safeDailySpend',
                'priorityRemaining',
                'goalSaveProgress',
                'priorityChecklist',
                'actionAlerts',
                'cockpitBudgetMeters',
                'avgIncome',
                'monthlyChart',
                'estimatePanel',
                'salaryList',
                'monthComparison',
                'savingsPressure',
            ],
        },
        uploadStatements: {
            label: 'Upload Statements',
            targets: ['uploadStatements'],
        },
        priorityRules: {
            label: 'Priority Rules',
            targets: ['priorityRules'],
        },
        budget: {
            label: 'Budget Plan',
            targets: ['budget', 'budgetTargets', 'settingsPanel'],
        },
        payments: {
            label: 'Payments',
            targets: ['payments', 'essentialPayments', 'subscriptionDetector', 'priorityPayments', 'nonPriorityPayments'],
        },
        transactions: {
            label: 'Transactions',
            targets: ['transactions', 'cashflowCalendar', 'merchantEditorSummary'],
        },
        accountSettings: {
            label: 'Account',
            targets: ['accountSettings'],
        },
    };

    const mainContent = document.querySelector('.main-content');
    const row = document.querySelector('.main-content-wrap .row');
    if (!mainContent || !row) return;

    const sections = Array.from(row.children).filter((node) => node.matches('[class*="col-"]'));
    sections.forEach((section) => {
        section.classList.add('bd-page-section');
        section.dataset.view = 'overview';
    });

    function closestSection(id) {
        const node = document.getElementById(id);
        return node ? node.closest('[class*="col-"]') : null;
    }

    Object.entries(views).forEach(([view, config]) => {
        config.targets.forEach((id) => {
            const section = closestSection(id);
            if (section) section.dataset.view = view;
        });
    });

    function setActiveNav(view) {
        document.querySelectorAll('.menu-item, .menu-item-button').forEach((node) => node.classList.remove('active'));
        const active = document.querySelector(`.menu-item-button[data-view="${view}"]`);
        if (!active) return;
        active.classList.add('active');
        active.closest('.menu-item')?.classList.add('active');
    }

    function switchView(view, replaceHistory) {
        const nextView = views[view] ? view : 'overview';
        mainContent.classList.add('is-loading');

        window.setTimeout(() => {
            sections.forEach((section) => {
                section.hidden = section.dataset.view !== nextView;
            });
            setActiveNav(nextView);
            mainContent.dataset.activeView = nextView;
            if (!replaceHistory) history.pushState({ view: nextView }, '', `#${nextView}`);
            mainContent.classList.remove('is-loading');
            mainContent.scrollTo({ top: 0, behavior: 'smooth' });
        }, 80);
    }

    document.querySelectorAll('.menu-item-button[href^="#"]').forEach((link) => {
        const view = link.getAttribute('href').slice(1);
        if (!views[view]) return;
        link.dataset.view = view;
        link.addEventListener('click', (event) => {
            event.preventDefault();
            switchView(view, false);
        });
    });

    document.addEventListener('click', (event) => {
        const settingsButton = event.target.closest('[data-open-settings]');
        if (!settingsButton) return;
        const settingsSection = closestSection('settingsPanel');
        const settingsView = settingsButton.dataset.openSettings === 'overrides' ? 'transactions' : 'budget';
        if (settingsSection) settingsSection.dataset.view = settingsView;
        switchView(settingsView, false);
    });

    window.addEventListener('popstate', () => {
        switchView(window.location.hash.slice(1) || 'overview', true);
    });

    window.BankDashRouter = {
        switchView: (view) => switchView(view, false),
    };

    document.addEventListener('bankdash:navigate', (event) => {
        switchView(event.detail?.view || 'overview', false);
    });

    switchView(window.location.hash.slice(1) || 'overview', true);
})();
